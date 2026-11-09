// Datenbankzugriff. In der Desktop-App: verschlüsselte SQLite-Datei (SQLCipher) über Rust-Befehle.
// Im Browser (Entwicklung/Vorschau): sql.js im Speicher, damit die Oberfläche auch ohne Tauri läuft.
import { MIGRATIONS } from './schema';

export type Row = Record<string, any>;
type Param = string | number | null;

interface Driver {
  select(sql: string, params: Param[]): Promise<Row[]>;
  /** nur lesende Abfrage, sonst Fehler (für den KI-Assistenten) */
  selectLesend(sql: string): Promise<Row[]>;
  execute(sql: string, params: Param[]): Promise<{ lastInsertId?: number; rowsAffected: number }>;
}

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

async function invoke<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

// In der Desktop-App: verschlüsselte SQLite-Datei (SQLCipher) über eigene Rust-Befehle, erst nach Eingabe des App-Passworts
function tauriDriver(): Driver {
  return {
    select: (sql, params) => invoke<Row[]>('db_select', { sql, params }),
    selectLesend: (sql) => invoke<Row[]>('db_select_lesend', { sql }),
    execute: (sql, params) => invoke<{ lastInsertId: number; rowsAffected: number }>('db_execute', { sql, params }),
  };
}

async function browserDriver(): Promise<Driver> {
  const initSqlJs = (await import('sql.js')).default;
  const wasmUrl = (await import('sql.js/dist/sql-wasm.wasm?url')).default;
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database();
  db.run('PRAGMA foreign_keys = ON');
  return {
    select: async (sql, p) => {
      // $1, $2 … als ?1, ?2 binden, damit die Reihenfolge im SQL keine Rolle spielt (wie in der App)
      const stmt = db.prepare(sql.replace(/\$(\d+)/g, '?$1'));
      stmt.bind(p);
      const rows: Row[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
    selectLesend: async (sql) => {
      const stmt = db.prepare(sql);
      try {
        // sql.js kennt kein readonly(): nur eine einzelne SELECT/WITH-Anweisung ohne Schreibbefehle zulassen
        const t = sql.trim().replace(/;\s*$/, '');
        if (!/^(select|with)\b/i.test(t) || t.includes(';') || /\b(insert|update|delete|drop|alter|create|replace|attach|pragma|vacuum)\b/i.test(t))
          throw new Error('Nur lesende Abfragen (SELECT) sind erlaubt.');
        const rows: Row[] = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        return rows;
      } finally { stmt.free(); }
    },
    execute: async (sql, p) => {
      if (p.length) db.run(sql.replace(/\$(\d+)/g, '?$1'), p);
      else db.exec(sql);
      const id = db.exec('SELECT last_insert_rowid()')[0]?.values[0][0] as number;
      return { lastInsertId: id, rowsAffected: db.getRowsModified() };
    },
  };
}

let ready: Promise<Driver> | null = null;

/* =================== Mehrplatz: NANO-Server im Büronetz =================== */
const SERVER_KEY = 'nano-server';
export type Benutzer = { name: string; login: string; rolle: 'admin' | 'mitarbeiter' | 'lesend' };
let token: string | null = null;
let ich: Benutzer | null = null;
export const ABGEMELDET = 'nano-abgemeldet';

function serverAdresse(): string | null {
  try { const v = JSON.parse(localStorage.getItem(SERVER_KEY) || 'null'); return v?.url || null; } catch { return null; }
}
async function anfrage<T = any>(pfad: string, methode: 'GET' | 'POST' = 'POST', body?: unknown, basis = serverAdresse()): Promise<T> {
  if (!basis) throw new Error('Kein NANO-Server eingerichtet.');
  const url = basis.replace(/\/+$/, '') + pfad;
  let status: number, text: string;
  if (isTauri) {
    const r = await invoke<{ status: number; text: string }>('server_anfrage', { url, methode, token, body: body === undefined ? null : JSON.stringify(body) });
    status = r.status; text = r.text;
  } else {
    let r: Response;
    try {
      r = await fetch(url, { method: methode, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch { throw new Error('Server nicht erreichbar. Bitte Adresse und Netzwerk prüfen.'); }
    status = r.status; text = await r.text();
  }
  let d: any = {};
  try { d = text ? JSON.parse(text) : {}; } catch { throw new Error(`Unerwartete Antwort vom Server (${status}). Ist die Adresse richtig?`); }
  if (status === 401 && pfad !== '/api/anmelden') { token = null; ich = null; ready = null; window.dispatchEvent(new Event(ABGEMELDET)); }
  if (status >= 400) throw new Error(d.fehler ?? `Fehler ${status}`);
  return d as T;
}
function serverDriver(): Driver {
  return {
    select: (sql, params) => anfrage<Row[]>('/api/select', 'POST', { sql, params }),
    selectLesend: (sql) => anfrage<Row[]>('/api/lesend', 'POST', { sql }),
    execute: (sql, params) => anfrage('/api/execute', 'POST', { sql, params }),
  };
}

/** Mehrplatz-Betrieb: alle Arbeitsplätze arbeiten auf derselben Datenbank im NANO-Server */
export const mehrplatz = {
  get aktiv() { return !!serverAdresse(); },
  adresse: serverAdresse,
  benutzer: () => ich,
  /** Prüft, ob unter der Adresse ein NANO-Server antwortet */
  async testen(url: string) {
    const r = await anfrage<{ name: string; version: string }>('/api/info', 'GET', undefined, normalisieren(url));
    if (r.name !== 'NANO-Server') throw new Error('Unter dieser Adresse antwortet kein NANO-Server.');
    return r;
  },
  einstellen(url: string | null) {
    if (url) localStorage.setItem(SERVER_KEY, JSON.stringify({ url: normalisieren(url) })); else localStorage.removeItem(SERVER_KEY);
    token = null; ich = null; ready = null;
  },
  async anmelden(login: string, passwort: string) {
    const r = await anfrage<Benutzer & { token: string }>('/api/anmelden', 'POST', { login, passwort });
    token = r.token; ich = { name: r.name, login: r.login, rolle: r.rolle };
    const d = serverDriver();
    ready = migrate(d).then(() => d).catch((e) => {
      ready = null;
      throw new Error(/Administrator/.test(String(e?.message)) ? 'Die Datenbank auf dem Server muss für diese NANO-Version aktualisiert werden. Bitte einmal als Administrator anmelden.' : e?.message ?? String(e));
    });
    await ready;
    const ablage = mehrplatz.ablageHier();
    if (isTauri && ablage) await invoke('ablage_freigeben', { pfad: ablage }).catch(() => {});
    return ich;
  },
  async abmelden() {
    if (token) await anfrage('/api/abmelden').catch(() => {});
    token = null; ich = null; ready = null;
  },
  /** Ablageordner auf diesem Rechner (z. B. Netzlaufwerk der NAS), je Arbeitsplatz verschieden */
  ablageHier: (): string => { try { return localStorage.getItem('nano-ablage-pfad') ?? ''; } catch { return ''; } },
  async ablageHierSetzen(pfad: string) {
    localStorage.setItem('nano-ablage-pfad', pfad.trim());
    if (isTauri && pfad.trim()) await invoke('ablage_freigeben', { pfad: pfad.trim() }).catch(() => {});
  },
  benutzerListe: () => anfrage<Row[]>('/api/benutzer', 'GET'),
  benutzerSpeichern: (b: Row) => anfrage('/api/benutzer', 'POST', b),
  passwortAendern: (alt: string, neu: string) => anfrage('/api/passwort', 'POST', { alt, neu }),
  protokoll: (n = 200) => anfrage<Row[]>(`/api/protokoll?n=${n}`, 'GET'),
  sicherung: () => anfrage<{ datei: string }>('/api/sicherung'),
  /**
   * Überträgt alle Daten dieses Arbeitsplatzes auf den Server (einmalig beim Umstieg).
   * Der Server wird vorher gesichert, die Tabellen dort werden ersetzt.
   */
  async datenUebertragen(url: string, login: string, passwort: string, fortschritt: (t: string) => void) {
    const lokal = await driver();
    const alt = serverAdresse();
    mehrplatz.einstellen(url);
    try {
      await mehrplatz.anmelden(login, passwort);
      if (ich?.rolle !== 'admin') throw new Error('Für die Übertragung bitte als Administrator anmelden.');
      const tabellen = (await lokal.select(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_schema') ORDER BY name`, [])).map((t) => String(t.name));
      for (let i = 0; i < tabellen.length; i++) {
        const t = tabellen[i];
        const zeilen = await lokal.select(`SELECT * FROM "${t}"`, []);
        fortschritt(`${i + 1}/${tabellen.length}: ${t} (${zeilen.length})`);
        for (let j = 0; j === 0 || j < zeilen.length; j += 500)
          await anfrage('/api/import', 'POST', { tabelle: t, zeilen: zeilen.slice(j, j + 500), erste: i === 0 && j === 0, sicherung: i === 0 && j === 0, erste_der_tabelle: j === 0, letzte: i === tabellen.length - 1 && j + 500 >= zeilen.length });
      }
      // AUTOINCREMENT-Zähler auf dem Server stimmen nach dem Einfügen mit festen ids automatisch
      fortschritt('Fertig');
    } catch (e) { mehrplatz.einstellen(alt); throw e; }
  },
};
function normalisieren(url: string) {
  let u = url.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  if (!/:\d+$/.test(u.replace(/^https?:\/\//, '')) && /^http:/i.test(u)) u += ':8080';
  return u;
}

async function migrate(d: Driver) {
  await d.execute('CREATE TABLE IF NOT EXISTS _schema (version INTEGER NOT NULL)', []);
  const rows = await d.select('SELECT MAX(version) AS v FROM _schema', []);
  const current = Number(rows[0]?.v ?? 0);
  // Jede Migration mit ihrem Versionseintrag in einer Transaktion: scheitert sie, bleibt die Datenbank wie vorher
  for (let i = current; i < MIGRATIONS.length; i++) {
    try {
      await d.execute(`BEGIN;\n${MIGRATIONS[i]}\nINSERT INTO _schema (version) VALUES (${i + 1});\nCOMMIT;`, []);
    } catch (e) {
      await d.execute('ROLLBACK', []).catch(() => {});
      throw e;
    }
  }
  if (!isTauri && !serverAdresse() && current === 0) await seedDemo(d);
}

function driver(): Promise<Driver> {
  if (!ready) {
    if (serverAdresse()) return Promise.reject(new Error('Bitte am NANO-Server anmelden.'));
    if (isTauri) return Promise.reject(new Error('Die Datenbank ist gesperrt.'));
    ready = browserDriver().then(async (d) => { await migrate(d); return d; });
  }
  return ready;
}

/** Anmeldung, Sperre und Datensicherung (nur Desktop-App) */
export const sicherheit = {
  aktiv: isTauri,
  status: () => invoke<{ eingerichtet: boolean; alte_daten: boolean; offen: boolean }>('db_status'),
  async entsperren(passwort: string, neu: boolean) {
    await invoke(neu ? 'db_einrichten' : 'db_oeffnen', { passwort });
    const d = tauriDriver();
    // Vor einer Datenbank-Aktualisierung (neue NANO-Version) immer zuerst eine Sicherung anlegen
    if (!neu) {
      const v = await d.select('SELECT MAX(version) AS v FROM _schema', []).then((r) => Number(r[0]?.v ?? 0)).catch(() => 0);
      if (v > 0 && v < MIGRATIONS.length) await invoke('db_sicherung_erstellen', { ordnerPfad: null });
    }
    ready = migrate(d).then(() => d);
    await ready;
    // Ablageordner aus den Einstellungen für Dateizugriff freigeben, tägliche Sicherung anlegen
    const a = (await d.select(`SELECT wert FROM einstellungen WHERE schluessel = 'ablage_pfad'`, []))[0]?.wert;
    if (a) await invoke('ablage_freigeben', { pfad: String(a) }).catch(() => {});
    await invoke('db_auto_sicherung').catch(() => {});
  },
  async sperren() {
    ready = null;
    await invoke('db_sperren');
  },
  passwortAendern: (alt: string, neu: string) => invoke('db_passwort_aendern', { alt, neu }),
  sicherungErstellen: (ordnerPfad?: string) => invoke<string>('db_sicherung_erstellen', { ordnerPfad: ordnerPfad ?? null }),
  sicherungen: () => invoke<{ name: string; pfad: string; groesse: number }[]>('db_sicherungen'),
  async wiederherstellen(pfad: string, passwort: string) {
    ready = null;
    await invoke('db_wiederherstellen', { pfad, passwort });
  },
  ablageFreigeben: (pfad: string) => invoke('ablage_freigeben', { pfad }),
};

/** Wird bei jedem Schreibvorgang ausgelöst, das Logo zeigt dann kurz stärkeren Datenverkehr */
export const DATEN_EVENT = 'nano-daten';

export const db = {
  async select<T = Row>(sql: string, params: Param[] = []): Promise<T[]> {
    return (await driver()).select(sql, params) as Promise<T[]>;
  },
  async selectLesend(sql: string): Promise<Row[]> {
    return (await driver()).selectLesend(sql);
  },
  async execute(sql: string, params: Param[] = []) {
    const r = await (await driver()).execute(sql, params);
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(DATEN_EVENT));   // Logo zeigt Datenverkehr
    return r;
  },
  isDemo: !isTauri,
};

// Einfache Tabellen-Helfer
export async function insert(table: string, values: Row): Promise<number> {
  const keys = Object.keys(values);
  const sql = `INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => '$' + (i + 1)).join(',')})`;
  const r = await db.execute(sql, keys.map((k) => values[k]));
  return r.lastInsertId ?? 0;
}
export async function update(table: string, id: number, values: Row) {
  const keys = Object.keys(values);
  const sql = `UPDATE ${table} SET ${keys.map((k, i) => `${k} = $${i + 1}`).join(', ')} WHERE id = $${keys.length + 1}`;
  await db.execute(sql, [...keys.map((k) => values[k]), id]);
}
export async function remove(table: string, id: number) {
  await db.execute(`DELETE FROM ${table} WHERE id = $1`, [id]);
}

// Beispieldaten nur für die Browser-Vorschau
async function seedDemo(d: Driver) {
  const ex = (s: string) => d.execute(s, []);
  await ex(`INSERT INTO personen (rolle, anrede, vorname, nachname, ort, telefon, email, iban) VALUES
    ('Eigentümer','Herr','Ahmet','Yilmaz','Köln','0221 123456','yilmaz@example.de','DE02120300000000202051'),
    ('Mieter','Frau','Anna','Schmidt','Köln','0170 111111','schmidt@example.de',NULL),
    ('Mieter','Herr','Jonas','Becker','Köln','0170 222222',NULL,NULL),
    ('Mieter','Firma',NULL,NULL,'Köln',NULL,NULL,NULL),
    ('Eigentümer','Frau','Maria','Wagner','Bonn','0228 55555','wagner@example.de',NULL),
    ('Eigentümer','Herr','Peter','Hoffmann','Köln',NULL,NULL,NULL),
    ('Mieter','Herr','Luca','Romano','Köln',NULL,NULL,NULL)`);
  await ex(`UPDATE personen SET firma='Bäckerei Krüger GmbH' WHERE id=4`);
  await ex(`INSERT INTO firmen (name, gewerk, ansprechpartner, ort, telefon, email) VALUES
    ('Sanitär Özdemir GmbH','Sanitär / Heizung','Hr. Özdemir','Köln','0221 987654','info@example.de'),
    ('Hausmeisterservice Rhein','Hausmeister','Fr. Klein','Köln','0221 444444',NULL),
    ('ista Deutschland','Messdienst',NULL,'Essen',NULL,NULL)`);
  await ex(`INSERT INTO objekte (verwaltungsart, name, strasse, plz, ort, baujahr, gesamt_mea, heizungsart, eigentuemer_id) VALUES
    ('Mietverwaltung','Lindenstraße 12','Lindenstraße 12','50674','Köln',1965,1000,'Gas-Zentralheizung',1),
    ('WEG','WEG Rheinblick','Rheinuferstraße 5','50668','Köln',1998,1000,'Fernwärme',NULL)`);
  await ex(`INSERT INTO einheiten (objekt_id, nummer, typ, lage, flaeche, mea) VALUES
    (1,'WE 01','Wohnung','EG links',62.5,250),(1,'WE 02','Wohnung','EG rechts',78,300),
    (1,'WE 03','Wohnung','1. OG',95,350),(1,'Laden','Gewerbe','EG Straße',40,100),
    (2,'WE 1','Wohnung','EG',71,330),(2,'WE 2','Wohnung','1. OG',71,330),(2,'WE 3','Wohnung','DG',75,340)`);
  await ex(`INSERT INTO eigentum (einheit_id, person_id, anteil, von) VALUES
    (5,5,100,'2015-01-01'),(6,6,100,'2018-05-01'),(7,1,100,'2020-01-01')`);
  await ex(`INSERT INTO beiraete (objekt_id, person_id, funktion) VALUES (2,5,'Vorsitz')`);
  await ex(`UPDATE einheiten SET personenzahl = CASE id WHEN 5 THEN 2 WHEN 6 THEN 1 WHEN 7 THEN 3 END WHERE objekt_id = 2`);
  await ex(`INSERT INTO hausgeld (einheit_id, gueltig_ab, betrag, davon_ruecklage) VALUES
    (5,'2024-01-01',310,80),(6,'2024-01-01',310,80),(7,'2024-01-01',325,85)`);
  await ex(`INSERT INTO mietvertraege (einheit_id, mieter_id, beginn, ende, kaltmiete, nk_vorauszahlung, hk_vorauszahlung, kaution, personenzahl, ust_satz, mietart) VALUES
    (1,2,'2024-04-01',NULL,620,140,80,1860,1,0,'Standard'),
    (2,3,'2025-08-01','2026-12-31',790,170,95,2370,3,0,'Staffelmiete'),
    (4,4,'2023-01-01',NULL,900,120,60,2700,0,19,'Indexmiete'),
    (6,7,'2025-03-01',NULL,700,150,90,2100,2,0,'Standard')`);
  // Vermietete WEG-Einheit: Mieter zahlt an den Eigentümer, wir erstellen nur seine Nebenkostenabrechnung
  await ex(`UPDATE mietvertraege SET zahlung_an = 'Eigentümer' WHERE einheit_id = 6`);
  await ex(`INSERT INTO bankkonten (objekt_id, name, bank, iban) VALUES
    (1,'Mietkonto Lindenstraße','Sparkasse KölnBonn','DE11370501980000000001'),
    (2,'WEG-Konto Rheinblick','Volksbank Köln Bonn','DE22380601860000000002')`);
  // Kosten 2025 für die Beispiel-Abrechnungen
  const k = async (nr: string) => (await d.select('SELECT id FROM buchungskonten WHERE nummer = $1', [nr]))[0].id;
  const rech: [number, string, string, number, number | null][] = [
    [1, '1220', '2025-02-15', 1240, null], [1, '1215', '2025-12-10', 2380, null], [1, '1222', '2025-03-01', 960, null],
    [1, '1246', '2025-12-31', 1800, 2], [1, '1250', '2025-01-20', 1150, null], [1, '1200', '2025-12-31', 6200, 3],
    [1, '1243', '2025-12-31', 720, 2], [1, '1300', '2025-06-12', 840, 1], [1, '1400', '2025-12-31', 1440, null],
    [2, '1220', '2025-02-15', 980, null], [2, '1250', '2025-01-20', 890, null], [2, '1246', '2025-12-31', 1500, 2],
    [2, '1200', '2025-12-31', 4300, 3], [2, '1400', '2025-12-31', 1080, null], [2, '1300', '2025-09-01', 2100, 1],
  ];
  for (const [o, nr, dt, betrag, firma] of rech) {
    await d.execute('INSERT INTO rechnungen (objekt_id, datum, betrag, buchungskonto_id, firma_id, bezahlt_am) VALUES ($1, $2, $3, $4, $5, $2)',
      [o, dt, betrag, await k(nr), firma]);
  }
  await ex(`UPDATE eigentum SET von = '2015-01-01'`);
  await ex(`INSERT INTO mietanpassungen (vertrag_id, gueltig_ab, art, kaltmiete) VALUES (2,'2026-08-01','Staffel',820)`);
  await ex(`UPDATE objekte SET ruecklage_anfang = 28500, ruecklage_stichtag = '2023-12-31' WHERE id = 2`);
  await ex(`INSERT INTO versammlungen (objekt_id, datum, art, ort, status) VALUES
    (2,'2025-04-15','Ordentliche Versammlung','Büro KMS','Durchgeführt'),(2,'2027-04-20','Ordentliche Versammlung','Büro KMS','Geplant')`);
  await ex(`INSERT INTO beschluesse (objekt_id, versammlung_id, nummer, datum, betreff, art, ergebnis, zustimmung, status, betrag) VALUES
    (2,1,'B-2025-01','2025-04-15','Instandhaltungsplan 2025','Organisation','Angenommen',100,'Erledigt',NULL),
    (2,1,'B-2025-02','2025-04-15','Anpassung Hausgeld ab 01.01.2026','Finanzen','Angenommen',100,'Erledigt',NULL),
    (2,1,'B-2025-03','2025-04-15','Sanierung Fassade','Investition','Angenommen',80,'In Umsetzung',80000)`);
  await ex(`INSERT INTO vorgaenge (objekt_id, einheit_id, betreff, art, prioritaet, status, faellig, firma_id, kosten) VALUES
    (2,NULL,'Heizungswartung','Wartung','Mittel','In Arbeit','2026-12-15',1,450),
    (1,2,'Wasserschaden Bad WE 02','Schaden','Hoch','Offen','2026-11-20',1,1200),
    (1,NULL,'Dachrinne reinigen','Instandhaltung','Niedrig','Erledigt','2026-09-30',2,180),
    (2,NULL,'Aufzugsprüfung TÜV','Wartung','Hoch','Offen','2026-12-01',NULL,600)`);
  await ex(`INSERT INTO ruecklage_massnahmen (objekt_id, massnahme, betrag, jahr, status) VALUES
    (2,'Fassadensanierung (1. BA)',80000,2027,'Beschlossen'),(2,'Dachsanierung',60000,2029,'Vorgesehen')`);
}
