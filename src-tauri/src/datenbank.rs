//! Verschlüsselte Datenbank (SQLCipher, AES-256) mit App-Passwort.
//! Die Datei `kms-verwaltung-sicher.db` liegt im App-Konfigurationsordner und ist ohne Passwort nicht lesbar.
//! Eine ältere, unverschlüsselte Datei `kms-verwaltung.db` wird beim Festlegen des Passworts übernommen und danach gelöscht.
//! Sicherungen sind ebenfalls verschlüsselt (gleiches Passwort).
use rusqlite::{types::ValueRef, Connection, OpenFlags};
use serde::Serialize;
use serde_json::{Map, Number, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

const DATEI: &str = "kms-verwaltung-sicher.db";
const ALT: &str = "kms-verwaltung.db";
const SICHERUNGEN_BEHALTEN: usize = 14;

#[derive(Default)]
pub struct DbState(pub Mutex<Option<Offen>>);

pub struct Offen {
  conn: Connection,
  passwort: String,
}

impl Drop for Offen {
  fn drop(&mut self) {
    // Passwort im Speicher überschreiben
    unsafe { self.passwort.as_bytes_mut().fill(0) };
  }
}

fn ordner(app: &AppHandle) -> Result<PathBuf, String> {
  let d = app.path().app_config_dir().map_err(|e| e.to_string())?;
  fs::create_dir_all(&d).map_err(|e| e.to_string())?;
  Ok(d)
}

fn sicherungsordner(app: &AppHandle) -> Result<PathBuf, String> {
  let d = ordner(app)?.join("Sicherungen");
  fs::create_dir_all(&d).map_err(|e| e.to_string())?;
  Ok(d)
}

/// SQL-Zeichenkette für PRAGMA key / KEY in ATTACH
fn literal(s: &str) -> String {
  format!("'{}'", s.replace('\'', "''"))
}

fn oeffne_datei(pfad: &Path, passwort: &str, erstellen: bool) -> Result<Connection, String> {
  if !erstellen && !pfad.exists() {
    return Err("Datei nicht gefunden.".into());
  }
  // CREATE auch beim Öffnen, sonst kann ATTACH keine neue Sicherungsdatei anlegen
  let flags = OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE | OpenFlags::SQLITE_OPEN_NO_MUTEX;
  let conn = Connection::open_with_flags(pfad, flags).map_err(|e| e.to_string())?;
  conn.execute_batch(&format!("PRAGMA key = {};", literal(passwort))).map_err(|e| e.to_string())?;
  // Ein falsches Passwort fällt erst beim ersten Lesen auf
  conn
    .query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))
    .map_err(|_| "Das Passwort ist falsch.".to_string())?;
  conn.execute_batch("PRAGMA foreign_keys = ON;").map_err(|e| e.to_string())?;
  Ok(conn)
}

#[derive(Serialize)]
pub struct Status {
  pub eingerichtet: bool,      // verschlüsselte Datenbank vorhanden
  pub alte_daten: bool,        // unverschlüsselte Datenbank aus der Testversion vorhanden
  pub offen: bool,
}

#[tauri::command]
pub fn db_status(app: AppHandle, state: tauri::State<'_, DbState>) -> Result<Status, String> {
  let d = ordner(&app)?;
  Ok(Status {
    eingerichtet: d.join(DATEI).exists(),
    alte_daten: d.join(ALT).exists(),
    offen: state.0.lock().unwrap().is_some(),
  })
}

/// Erstes Festlegen des Passworts: legt die verschlüsselte Datenbank an und übernimmt vorhandene Daten.
#[tauri::command]
pub fn db_einrichten(app: AppHandle, state: tauri::State<'_, DbState>, passwort: String) -> Result<(), String> {
  if passwort.chars().count() < 8 {
    return Err("Das Passwort muss mindestens 8 Zeichen haben.".into());
  }
  let d = ordner(&app)?;
  let ziel = d.join(DATEI);
  if ziel.exists() {
    return Err("Es ist bereits ein Passwort festgelegt.".into());
  }
  let alt = d.join(ALT);
  if alt.exists() {
    // Unverschlüsselte Daten in die neue, verschlüsselte Datei exportieren
    let plain = Connection::open(&alt).map_err(|e| e.to_string())?;
    let tmp = d.join(format!("{DATEI}.neu"));
    let _ = fs::remove_file(&tmp);
    plain
      .execute_batch(&format!(
        "ATTACH DATABASE {} AS sicher KEY {}; SELECT sqlcipher_export('sicher'); DETACH DATABASE sicher;",
        literal(&tmp.to_string_lossy()),
        literal(&passwort)
      ))
      .map_err(|e| format!("Übernahme der Daten fehlgeschlagen: {e}"))?;
    let alt_tabellen: i64 = plain.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    drop(plain);
    // Prüfen, dass alles angekommen ist, erst dann die offene Datei entfernen
    let neu = oeffne_datei(&tmp, &passwort, false)?;
    let neu_tabellen: i64 = neu.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get(0)).map_err(|e| e.to_string())?;
    drop(neu);
    if neu_tabellen != alt_tabellen {
      let _ = fs::remove_file(&tmp);
      return Err("Übernahme der Daten unvollständig, die alte Datei bleibt erhalten.".into());
    }
    fs::rename(&tmp, &ziel).map_err(|e| e.to_string())?;
    for endung in ["", "-wal", "-shm", "-journal"] {
      let _ = fs::remove_file(d.join(format!("{ALT}{endung}")));
    }
  }
  let conn = oeffne_datei(&ziel, &passwort, true)?;
  *state.0.lock().unwrap() = Some(Offen { conn, passwort });
  Ok(())
}

#[tauri::command]
pub fn db_oeffnen(app: AppHandle, state: tauri::State<'_, DbState>, passwort: String) -> Result<(), String> {
  let pfad = ordner(&app)?.join(DATEI);
  if !pfad.exists() {
    return Err("Noch kein Passwort festgelegt.".into());
  }
  let conn = oeffne_datei(&pfad, &passwort, false)?;
  *state.0.lock().unwrap() = Some(Offen { conn, passwort });
  Ok(())
}

#[tauri::command]
pub fn db_sperren(state: tauri::State<'_, DbState>) {
  *state.0.lock().unwrap() = None;
}

#[tauri::command]
pub fn db_passwort_aendern(state: tauri::State<'_, DbState>, alt: String, neu: String) -> Result<(), String> {
  if neu.chars().count() < 8 {
    return Err("Das neue Passwort muss mindestens 8 Zeichen haben.".into());
  }
  let mut g = state.0.lock().unwrap();
  let o = g.as_mut().ok_or("Die Datenbank ist gesperrt.")?;
  if o.passwort != alt {
    return Err("Das bisherige Passwort ist falsch.".into());
  }
  o.conn.execute_batch(&format!("PRAGMA rekey = {};", literal(&neu))).map_err(|e| e.to_string())?;
  o.passwort = neu;
  Ok(())
}

/// $1, $2 … in ?1, ?2 umschreiben (außerhalb von Zeichenketten), damit die Reihenfolge im SQL egal ist
fn platzhalter(sql: &str) -> String {
  let mut out = String::with_capacity(sql.len());
  let mut in_str = false;
  let mut it = sql.chars().peekable();
  while let Some(c) = it.next() {
    if c == '\'' {
      in_str = !in_str;
      out.push(c);
    } else if c == '$' && !in_str && it.peek().map_or(false, |n| n.is_ascii_digit()) {
      out.push('?');
    } else {
      out.push(c);
    }
  }
  out
}

fn werte(params: &[Value]) -> Vec<rusqlite::types::Value> {
  use rusqlite::types::Value as V;
  params
    .iter()
    .map(|p| match p {
      Value::Null => V::Null,
      Value::Bool(b) => V::Integer(*b as i64),
      Value::Number(n) => n.as_i64().map(V::Integer).unwrap_or_else(|| V::Real(n.as_f64().unwrap_or(0.0))),
      Value::String(s) => V::Text(s.clone()),
      other => V::Text(other.to_string()),
    })
    .collect()
}

#[tauri::command]
pub fn db_select(state: tauri::State<'_, DbState>, sql: String, params: Vec<Value>) -> Result<Vec<Map<String, Value>>, String> {
  let g = state.0.lock().unwrap();
  let o = g.as_ref().ok_or("Die Datenbank ist gesperrt.")?;
  let mut stmt = o.conn.prepare(&platzhalter(&sql)).map_err(|e| e.to_string())?;
  let namen: Vec<String> = stmt.column_names().map(|s| s.to_string()).collect();
  let mut rows = stmt.query(rusqlite::params_from_iter(werte(&params))).map_err(|e| e.to_string())?;
  let mut out = Vec::new();
  while let Some(r) = rows.next().map_err(|e| e.to_string())? {
    let mut m = Map::new();
    for (i, n) in namen.iter().enumerate() {
      let v = match r.get_ref(i).map_err(|e| e.to_string())? {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(x) => Value::Number(x.into()),
        ValueRef::Real(x) => Number::from_f64(x).map(Value::Number).unwrap_or(Value::Null),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
        ValueRef::Blob(_) => Value::Null,
      };
      m.insert(n.clone(), v);
    }
    out.push(m);
  }
  Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ergebnis {
  rows_affected: u64,
  last_insert_id: i64,
}

#[tauri::command]
pub fn db_execute(state: tauri::State<'_, DbState>, sql: String, params: Vec<Value>) -> Result<Ergebnis, String> {
  let g = state.0.lock().unwrap();
  let o = g.as_ref().ok_or("Die Datenbank ist gesperrt.")?;
  let n = if params.is_empty() {
    // Ohne Parameter können mehrere Anweisungen kommen (Migrationen)
    o.conn.execute_batch(&sql).map_err(|e| e.to_string())?;
    o.conn.changes()
  } else {
    o.conn.execute(&platzhalter(&sql), rusqlite::params_from_iter(werte(&params))).map_err(|e| e.to_string())? as u64
  };
  Ok(Ergebnis { rows_affected: n, last_insert_id: o.conn.last_insert_rowid() })
}

/* ---------------- Datensicherung ---------------- */

fn sichern_nach(o: &Offen, ziel: &Path) -> Result<(), String> {
  let tmp = ziel.with_extension("tmp");
  let _ = fs::remove_file(&tmp);
  o.conn
    .execute_batch(&format!(
      "ATTACH DATABASE {} AS sicherung KEY {}; SELECT sqlcipher_export('sicherung'); DETACH DATABASE sicherung;",
      literal(&tmp.to_string_lossy()),
      literal(&o.passwort)
    ))
    .map_err(|e| format!("Sicherung fehlgeschlagen: {e}"))?;
  fs::rename(&tmp, ziel).map_err(|e| e.to_string())?;
  Ok(())
}

fn zeitstempel() -> String {
  chrono::Local::now().format("%Y-%m-%d_%H-%M").to_string()
}

#[derive(Serialize)]
pub struct Sicherung {
  pub name: String,
  pub pfad: String,
  pub groesse: u64,
}

/// Tägliche automatische Sicherung in den App-Ordner (die letzten 14 bleiben erhalten). Gibt den Pfad zurück, falls neu erstellt.
#[tauri::command]
pub fn db_auto_sicherung(app: AppHandle, state: tauri::State<'_, DbState>) -> Result<Option<String>, String> {
  let d = sicherungsordner(&app)?;
  let heute = chrono::Local::now().format("%Y-%m-%d").to_string();
  let mut vorhanden: Vec<PathBuf> = fs::read_dir(&d).map_err(|e| e.to_string())?
    .filter_map(|e| e.ok().map(|e| e.path()))
    .filter(|p| p.extension().map_or(false, |x| x == "nanosicherung"))
    .collect();
  vorhanden.sort();
  if vorhanden.iter().any(|p| p.file_name().map_or(false, |n| n.to_string_lossy().contains(&heute))) {
    return Ok(None);
  }
  let g = state.0.lock().unwrap();
  let o = g.as_ref().ok_or("Die Datenbank ist gesperrt.")?;
  let ziel = d.join(format!("NANO-Sicherung_{}.nanosicherung", zeitstempel()));
  sichern_nach(o, &ziel)?;
  vorhanden.push(ziel.clone());
  while vorhanden.len() > SICHERUNGEN_BEHALTEN {
    let _ = fs::remove_file(vorhanden.remove(0));
  }
  Ok(Some(ziel.to_string_lossy().into_owned()))
}

/// Sicherung jetzt erstellen, in den App-Ordner oder einen gewählten Ordner (z. B. USB-Stick, NAS)
#[tauri::command]
pub fn db_sicherung_erstellen(app: AppHandle, state: tauri::State<'_, DbState>, ordner_pfad: Option<String>) -> Result<String, String> {
  let d = match ordner_pfad {
    Some(p) if !p.is_empty() => PathBuf::from(p),
    _ => sicherungsordner(&app)?,
  };
  fs::create_dir_all(&d).map_err(|e| e.to_string())?;
  let g = state.0.lock().unwrap();
  let o = g.as_ref().ok_or("Die Datenbank ist gesperrt.")?;
  let ziel = d.join(format!("NANO-Sicherung_{}.nanosicherung", zeitstempel()));
  sichern_nach(o, &ziel)?;
  Ok(ziel.to_string_lossy().into_owned())
}

#[tauri::command]
pub fn db_sicherungen(app: AppHandle) -> Result<Vec<Sicherung>, String> {
  let d = sicherungsordner(&app)?;
  let mut v: Vec<Sicherung> = fs::read_dir(&d).map_err(|e| e.to_string())?
    .filter_map(|e| e.ok())
    .filter(|e| e.path().extension().map_or(false, |x| x == "nanosicherung"))
    .map(|e| Sicherung {
      name: e.file_name().to_string_lossy().into_owned(),
      pfad: e.path().to_string_lossy().into_owned(),
      groesse: e.metadata().map(|m| m.len()).unwrap_or(0),
    })
    .collect();
  v.sort_by(|a, b| b.name.cmp(&a.name));
  Ok(v)
}

/// Sicherung zurückspielen: Die Datei muss sich mit dem eingegebenen Passwort öffnen lassen.
/// Der aktuelle Stand wird vorher selbst gesichert. Danach ist die App gesperrt und man meldet sich mit dem Passwort der Sicherung an.
#[tauri::command]
pub fn db_wiederherstellen(app: AppHandle, state: tauri::State<'_, DbState>, pfad: String, passwort: String) -> Result<(), String> {
  let quelle = PathBuf::from(&pfad);
  oeffne_datei(&quelle, &passwort, false).map_err(|_| "Die Sicherung lässt sich mit diesem Passwort nicht öffnen.".to_string())?;
  let d = ordner(&app)?;
  let mut g = state.0.lock().unwrap();
  if let Some(o) = g.as_ref() {
    let vorher = sicherungsordner(&app)?.join(format!("NANO-vor-Wiederherstellung_{}.nanosicherung", zeitstempel()));
    sichern_nach(o, &vorher)?;
  }
  *g = None;
  let ziel = d.join(DATEI);
  let tmp = d.join(format!("{DATEI}.wiederherstellen"));
  fs::copy(&quelle, &tmp).map_err(|e| e.to_string())?;
  fs::rename(&tmp, &ziel).map_err(|e| e.to_string())?;
  Ok(())
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn platzhalter_ausserhalb_von_text() {
    assert_eq!(platzhalter("SELECT '$1', a FROM t WHERE x = $2 AND y = $1"), "SELECT '$1', a FROM t WHERE x = ?2 AND y = ?1");
  }

  #[test]
  fn verschluesselung_export_und_falsches_passwort() {
    let d = std::env::temp_dir().join(format!("nano-test-{}", std::process::id()));
    let _ = fs::remove_dir_all(&d);
    fs::create_dir_all(&d).unwrap();
    // unverschlüsselte Altdatei
    let alt = d.join("alt.db");
    let c = Connection::open(&alt).unwrap();
    c.execute_batch("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO t (name) VALUES ('Müller');").unwrap();
    let ziel = d.join("neu.db");
    c.execute_batch(&format!("ATTACH DATABASE {} AS sicher KEY {}; SELECT sqlcipher_export('sicher'); DETACH DATABASE sicher;",
      literal(&ziel.to_string_lossy()), literal("geheim123"))).unwrap();
    drop(c);
    // Richtiges Passwort öffnet, Daten sind da
    let n = oeffne_datei(&ziel, "geheim123", false).unwrap();
    let name: String = n.query_row("SELECT name FROM t", [], |r| r.get(0)).unwrap();
    assert_eq!(name, "Müller");
    // Sicherung mit gleichem Passwort
    let o = Offen { conn: n, passwort: "geheim123".into() };
    let s = d.join("s.nanosicherung");
    sichern_nach(&o, &s).unwrap();
    drop(o);
    assert!(oeffne_datei(&s, "geheim123", false).is_ok());
    // Falsches Passwort und unverschlüsseltes Lesen schlagen fehl
    assert!(oeffne_datei(&ziel, "falsch", false).is_err());
    let roh = fs::read(&ziel).unwrap();
    let m: &[u8] = "Müller".as_bytes();
    assert!(!roh.windows(m.len()).any(|w| w == m));
    assert!(!roh.starts_with(b"SQLite format 3"));
    let _ = fs::remove_dir_all(&d);
  }
}
