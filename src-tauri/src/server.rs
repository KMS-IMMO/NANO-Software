//! Verbindung zum NEOSS-Server (Mehrplatz). Die Anfragen laufen über Rust, damit http:// im Büronetz
//! auch unter macOS funktioniert (WebView blockiert sonst gemischte Inhalte).
use std::time::Duration;

#[derive(serde::Serialize)]
pub struct Antwort { status: u16, text: String }

#[tauri::command]
pub async fn server_anfrage(url: String, methode: String, token: Option<String>, body: Option<String>) -> Result<Antwort, String> {
  if !(url.starts_with("http://") || url.starts_with("https://")) { return Err("Die Serveradresse muss mit http:// oder https:// beginnen.".into()); }
  let client = reqwest::Client::builder().timeout(Duration::from_secs(60)).build().map_err(|e| e.to_string())?;
  let mut req = if methode == "GET" { client.get(&url) } else { client.post(&url) };
  if let Some(t) = token { req = req.header("authorization", format!("Bearer {t}")); }
  if let Some(b) = body { req = req.header("content-type", "application/json").body(b); }
  let r = req.send().await.map_err(|e| format!("Server nicht erreichbar: {e}"))?;
  let status = r.status().as_u16();
  let text = r.text().await.map_err(|e| e.to_string())?;
  Ok(Antwort { status, text })
}
