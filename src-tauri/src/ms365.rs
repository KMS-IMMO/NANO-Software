//! Microsoft 365: Outlook-Mail und -Kalender über Microsoft Graph.
//!
//! Anmeldung nach OAuth 2.0 für Desktop-Apps (öffentlicher Client mit PKCE): NEOSS öffnet das
//! Anmeldefenster von Microsoft im Browser, Microsoft leitet nach der Anmeldung auf
//! http://localhost:<Port> zurück, wo NEOSS kurz zuhört. NEOSS sieht nie ein Passwort.
//! Der Anmeldeschlüssel (Refresh-Token) liegt im Schlüsselbund des Betriebssystems, nie in der Datenbank.
//! Der kurzlebige Zugriffsschlüssel bleibt nur im Arbeitsspeicher.
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::time::{Duration, Instant};
use tauri_plugin_opener::OpenerExt;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::Mutex;

/// Eigener Eintrag im Schlüsselbund, getrennt vom Online-Banking
const DIENST: &str = "NEOSS Microsoft 365";
const SCOPES: &str = "offline_access openid profile User.Read Mail.ReadWrite Mail.Send Mail.ReadWrite.Shared Mail.Send.Shared Calendars.ReadWrite";
const GRAPH: &str = "https://graph.microsoft.com/v1.0";
/// Windows begrenzt einen Eintrag auf 2560 Bytes; der Schlüssel wird deshalb in Stücke geteilt
const STUECK: usize = 1200;

#[derive(Default)]
pub struct MsState(pub Mutex<Option<Zugang>>);

pub struct Zugang {
  access: String,
  gueltig_bis: Instant,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Gespeichert {
  client_id: String,
  tenant: String,
  refresh: String,
  name: String,
  mail: String,
}

#[derive(Serialize)]
pub struct Konto {
  pub name: String,
  pub mail: String,
}

#[derive(Deserialize)]
struct TokenAntwort {
  access_token: String,
  refresh_token: Option<String>,
  expires_in: Option<u64>,
}

fn eintrag(teil: &str) -> Result<keyring::Entry, String> {
  keyring::Entry::new(DIENST, teil).map_err(|e| format!("Schlüsselbund nicht verfügbar: {e}"))
}

fn laden() -> Option<Gespeichert> {
  let n: usize = eintrag("anmeldung-teile").ok()?.get_password().ok()?.parse().ok()?;
  let mut s = String::new();
  for i in 0..n {
    s.push_str(&eintrag(&format!("anmeldung-{i}")).ok()?.get_password().ok()?);
  }
  serde_json::from_str(&s).ok()
}

fn loeschen() {
  let n: usize = eintrag("anmeldung-teile").ok().and_then(|e| e.get_password().ok()).and_then(|t| t.parse().ok()).unwrap_or(0);
  for i in 0..n.max(1) + 2 {
    if let Ok(e) = eintrag(&format!("anmeldung-{i}")) { let _ = e.delete_credential(); }
  }
  if let Ok(e) = eintrag("anmeldung-teile") { let _ = e.delete_credential(); }
}

fn sichern(g: &Gespeichert) -> Result<(), String> {
  loeschen();
  let s = serde_json::to_string(g).map_err(|e| e.to_string())?;
  let teile: Vec<String> = s.as_bytes().chunks(STUECK).map(|c| String::from_utf8_lossy(c).into_owned()).collect();
  for (i, t) in teile.iter().enumerate() {
    eintrag(&format!("anmeldung-{i}"))?.set_password(t).map_err(|e| format!("Schlüsselbund: {e}"))?;
  }
  eintrag("anmeldung-teile")?.set_password(&teile.len().to_string()).map_err(|e| format!("Schlüsselbund: {e}"))
}

fn zufall(n: usize) -> String {
  let mut b = vec![0u8; n];
  rand::thread_rng().fill_bytes(&mut b);
  URL_SAFE_NO_PAD.encode(b)
}

fn mandant(t: &str) -> String {
  let t = t.trim();
  if t.is_empty() { "organizations".into() } else { t.to_string() }
}

fn pruefe_id(s: &str) -> bool {
  let s = s.trim();
  s.len() == 36 && s.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

fn fehlertext(v: &Value, status: u16) -> String {
  if let Some(t) = v.get("error_description").and_then(|x| x.as_str()) {
    let kurz = t.lines().next().unwrap_or(t);
    if kurz.contains("AADSTS65001") { return "Die Berechtigungen wurden noch nicht bestätigt. Bitte erneut anmelden und „Akzeptieren“ wählen.".into(); }
    if kurz.contains("AADSTS700016") { return "Microsoft kennt diese Anwendungs-ID nicht. Bitte die ID aus dem Microsoft-Portal prüfen.".into(); }
    if kurz.contains("AADSTS50011") { return "Die Weiterleitungsadresse fehlt in der App-Registrierung. Bitte „http://localhost“ unter „Mobile und Desktopanwendungen“ eintragen.".into(); }
    if kurz.contains("AADSTS7000218") { return "In der App-Registrierung muss „Öffentliche Clientflows zulassen“ auf „Ja“ stehen.".into(); }
    return kurz.to_string();
  }
  if let Some(t) = v.pointer("/error/message").and_then(|x| x.as_str()) {
    let code = v.pointer("/error/code").and_then(|x| x.as_str()).unwrap_or("");
    if code == "ErrorAccessDenied" || code == "AccessDenied" {
      return "Kein Zugriff. Für ein freigegebenes Postfach braucht dein Konto dort Vollzugriff (und zum Senden „Senden als“).".into();
    }
    return t.to_string();
  }
  format!("Microsoft meldet Fehler {status}")
}

async fn token_holen(tenant: &str, felder: &[(&str, &str)]) -> Result<TokenAntwort, String> {
  let url = format!("https://login.microsoftonline.com/{}/oauth2/v2.0/token", mandant(tenant));
  let r = reqwest::Client::new().post(url).form(felder).send().await.map_err(|e| format!("Keine Verbindung zu Microsoft: {e}"))?;
  let status = r.status().as_u16();
  let v: Value = r.json().await.map_err(|e| e.to_string())?;
  if status >= 400 { return Err(fehlertext(&v, status)); }
  serde_json::from_value(v).map_err(|e| e.to_string())
}

/// Wartet auf die Rückleitung von Microsoft und liefert die Parameter der Adresse
async fn rueckleitung(v4: TcpListener, v6: Option<TcpListener>) -> Result<Vec<(String, String)>, String> {
  loop {
    let (mut s, _) = match &v6 {
      Some(v6) => tokio::select! { a = v4.accept() => a, b = v6.accept() => b }.map_err(|e| e.to_string())?,
      None => v4.accept().await.map_err(|e| e.to_string())?,
    };
    let mut buf = vec![0u8; 16384];
    let mut n = 0;
    while n < buf.len() {
      let k = s.read(&mut buf[n..]).await.map_err(|e| e.to_string())?;
      if k == 0 { break; }
      n += k;
      if buf[..n].windows(4).any(|w| w == b"\r\n\r\n") { break; }
    }
    let anfrage = String::from_utf8_lossy(&buf[..n]).to_string();
    let pfad = anfrage.split_whitespace().nth(1).unwrap_or("/").to_string();
    let url = url::Url::parse(&format!("http://localhost{pfad}")).map_err(|e| e.to_string())?;
    let werte: Vec<(String, String)> = url.query_pairs().map(|(a, b)| (a.into_owned(), b.into_owned())).collect();
    let ok = werte.iter().any(|(k, _)| k == "code");
    let fehler = werte.iter().any(|(k, _)| k == "error");
    if !ok && !fehler {
      // z. B. favicon.ico: kurz antworten und weiter warten
      let _ = s.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n").await;
      continue;
    }
    let text = if ok { "Anmeldung erfolgreich. Du kannst dieses Fenster schließen und zu NEOSS zurückkehren." }
      else { "Die Anmeldung wurde abgebrochen. Du kannst dieses Fenster schließen." };
    let html = format!("<!doctype html><meta charset=utf-8><title>NEOSS</title><body style=\"font-family:-apple-system,Segoe UI,sans-serif;background:#f4f1ec;color:#24262b;display:grid;place-items:center;height:90vh\"><div style=\"background:#fff;padding:32px 40px;border-radius:16px;box-shadow:0 4px 16px rgba(0,0,0,.08);max-width:460px;text-align:center\"><div style=\"font-weight:700;font-size:22px;margin-bottom:8px\">KM<span style=\"color:#b5883a\">S</span> · NEOSS</div><p style=\"line-height:1.6\">{text}</p></div>");
    let antwort = format!("HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", html.len(), html);
    let _ = s.write_all(antwort.as_bytes()).await;
    let _ = s.shutdown().await;
    return Ok(werte);
  }
}

async fn graph_roh(access: &str, methode: &str, pfad: &str, body: &Option<Value>, text: bool) -> Result<(u16, Value), String> {
  let url = format!("{GRAPH}{pfad}");
  let c = reqwest::Client::new();
  let mut r = match methode {
    "GET" => c.get(url),
    "POST" => c.post(url),
    "PATCH" => c.patch(url),
    "DELETE" => c.delete(url),
    _ => return Err("Unbekannte Methode".into()),
  }
  .bearer_auth(access);
  if text { r = r.header("Prefer", "outlook.body-content-type=\"text\""); }
  if let Some(b) = body { r = r.json(b); } else if methode == "POST" { r = r.header("Content-Length", "0"); }
  let a = r.send().await.map_err(|e| format!("Keine Verbindung zu Microsoft: {e}"))?;
  let status = a.status().as_u16();
  let bytes = a.bytes().await.map_err(|e| e.to_string())?;
  let v: Value = if bytes.is_empty() { Value::Null } else { serde_json::from_slice(&bytes).unwrap_or(Value::Null) };
  Ok((status, v))
}

/// Gültiger Zugriffsschlüssel, bei Bedarf mit dem gespeicherten Anmeldeschlüssel erneuert
async fn zugriff(state: &MsState, neu: bool) -> Result<String, String> {
  let mut z = state.0.lock().await;
  if !neu {
    if let Some(a) = z.as_ref() {
      if a.gueltig_bis > Instant::now() + Duration::from_secs(60) { return Ok(a.access.clone()); }
    }
  }
  let mut g = laden().ok_or("Nicht mit Microsoft 365 verbunden. Bitte unter Kommunikation › Microsoft 365 anmelden.")?;
  let t = token_holen(&g.tenant, &[
    ("client_id", g.client_id.as_str()), ("grant_type", "refresh_token"), ("refresh_token", g.refresh.as_str()), ("scope", SCOPES),
  ]).await.map_err(|e| format!("Anmeldung bei Microsoft abgelaufen, bitte neu anmelden. ({e})"))?;
  if let Some(r) = t.refresh_token { g.refresh = r; let _ = sichern(&g); }
  *z = Some(Zugang { access: t.access_token.clone(), gueltig_bis: Instant::now() + Duration::from_secs(t.expires_in.unwrap_or(3600)) });
  Ok(t.access_token)
}

/// Anmeldung im Browser; liefert Name und Adresse des Kontos
#[tauri::command]
pub async fn ms_anmelden(app: tauri::AppHandle, state: tauri::State<'_, MsState>, client_id: String, tenant: String) -> Result<Konto, String> {
  let client_id = client_id.trim().to_string();
  if !pruefe_id(&client_id) { return Err("Die Anwendungs-ID hat nicht das richtige Format (36 Zeichen, z. B. 1a2b3c4d-…).".into()); }
  let v4 = TcpListener::bind("127.0.0.1:0").await.map_err(|e| e.to_string())?;
  let port = v4.local_addr().map_err(|e| e.to_string())?.port();
  let v6 = TcpListener::bind(("::1", port)).await.ok();
  let redirect = format!("http://localhost:{port}");
  let verifier = zufall(64);
  let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
  let status = zufall(24);
  let mut url = url::Url::parse(&format!("https://login.microsoftonline.com/{}/oauth2/v2.0/authorize", mandant(&tenant))).map_err(|e| e.to_string())?;
  url.query_pairs_mut()
    .append_pair("client_id", &client_id)
    .append_pair("response_type", "code")
    .append_pair("redirect_uri", &redirect)
    .append_pair("response_mode", "query")
    .append_pair("scope", SCOPES)
    .append_pair("state", &status)
    .append_pair("code_challenge", &challenge)
    .append_pair("code_challenge_method", "S256")
    .append_pair("prompt", "select_account");
  app.opener().open_url(url.as_str(), None::<&str>).map_err(|e| format!("Browser ließ sich nicht öffnen: {e}"))?;

  let werte = tokio::time::timeout(Duration::from_secs(300), rueckleitung(v4, v6)).await
    .map_err(|_| "Keine Anmeldung innerhalb von 5 Minuten. Bitte erneut versuchen.".to_string())??;
  let wert = |k: &str| werte.iter().find(|(a, _)| a == k).map(|(_, b)| b.clone());
  if let Some(e) = wert("error") {
    let d = wert("error_description").unwrap_or_default();
    return Err(fehlertext(&serde_json::json!({ "error_description": if d.is_empty() { e } else { d } }), 400));
  }
  if wert("state").as_deref() != Some(status.as_str()) { return Err("Ungültige Antwort bei der Anmeldung. Bitte erneut versuchen.".into()); }
  let code = wert("code").ok_or("Microsoft hat keinen Anmeldecode geliefert.")?;

  let t = token_holen(&tenant, &[
    ("client_id", client_id.as_str()), ("grant_type", "authorization_code"), ("code", code.as_str()),
    ("redirect_uri", redirect.as_str()), ("code_verifier", verifier.as_str()), ("scope", SCOPES),
  ]).await?;
  let refresh = t.refresh_token.clone().ok_or("Microsoft hat keinen dauerhaften Anmeldeschlüssel geliefert (offline_access fehlt).")?;
  let (st, ich) = graph_roh(&t.access_token, "GET", "/me?$select=displayName,mail,userPrincipalName", &None, false).await?;
  if st >= 400 { return Err(fehlertext(&ich, st)); }
  let name = ich.get("displayName").and_then(|x| x.as_str()).unwrap_or("").to_string();
  let mail = ich.get("mail").and_then(|x| x.as_str()).or_else(|| ich.get("userPrincipalName").and_then(|x| x.as_str())).unwrap_or("").to_string();
  sichern(&Gespeichert { client_id, tenant: tenant.trim().to_string(), refresh, name: name.clone(), mail: mail.clone() })?;
  *state.0.lock().await = Some(Zugang { access: t.access_token, gueltig_bis: Instant::now() + Duration::from_secs(t.expires_in.unwrap_or(3600)) });
  Ok(Konto { name, mail })
}

/// Verbundenes Konto laut Schlüsselbund (ohne Netz)
#[tauri::command]
pub fn ms_status() -> Option<Konto> {
  laden().map(|g| Konto { name: g.name, mail: g.mail })
}

/// Verbindung trennen: Schlüssel aus dem Schlüsselbund und dem Speicher entfernen
#[tauri::command]
pub async fn ms_abmelden(state: tauri::State<'_, MsState>) -> Result<(), String> {
  loeschen();
  *state.0.lock().await = None;
  Ok(())
}

/// Anfrage an Microsoft Graph, nur für Postfächer und Kalender (/me/… oder /users/…/…)
#[tauri::command]
pub async fn ms_graph(state: tauri::State<'_, MsState>, methode: String, pfad: String, body: Option<Value>, text: Option<bool>) -> Result<Value, String> {
  let methode = methode.to_uppercase();
  let erlaubt = (pfad.starts_with("/me/") || pfad.starts_with("/me?") || pfad == "/me" || pfad.starts_with("/users/"))
    && !pfad.contains("..") && !pfad.contains('#') && !pfad.contains("://");
  if !erlaubt { return Err("Diese Anfrage ist nicht erlaubt.".into()); }
  let text = text.unwrap_or(false);
  let a = zugriff(&state, false).await?;
  let (mut st, mut v) = graph_roh(&a, &methode, &pfad, &body, text).await?;
  if st == 401 {
    let a = zugriff(&state, true).await?;
    (st, v) = graph_roh(&a, &methode, &pfad, &body, text).await?;
  }
  if st >= 400 { return Err(fehlertext(&v, st)); }
  Ok(v)
}

#[cfg(test)]
mod tests {
  use super::*;
  #[test]
  fn id_format() {
    assert!(pruefe_id("1a2b3c4d-1234-5678-9abc-def012345678"));
    assert!(!pruefe_id("abc"));
  }
  #[test]
  fn pkce_laenge() {
    let v = zufall(64);
    assert!(v.len() >= 43 && v.len() <= 128);
  }
}
