//! Bankabruf per FinTS 3.0 (PIN/TAN) mit Freigabe in der Banking-App (pushTAN / decoupled).
//! Ablauf: `bank_start` meldet sich an und löst die Freigabe aus, `bank_abholen` fragt so lange nach,
//! bis die Freigabe erteilt ist, und liefert dann die Umsätze.
//! Auf Wunsch liegt die PIN verschlüsselt im Schlüsselbund des Betriebssystems (macOS-Schlüsselbund,
//! Windows-Anmeldeinformationen), nie in der Datenbank. Zusammen mit der gemerkten System-ID der Bank
//! erlaubt das den automatischen Abruf ohne Freigabe, solange die Bank ihn zulässt (PSD2: etwa 90 Tage).
use fints::{Flow, Pin, ProductId, SystemId, UserId};
use serde::Serialize;
use tokio::sync::Mutex;

#[derive(Default)]
pub struct BankState(pub Mutex<Option<Flow>>);

#[derive(Serialize)]
pub struct Start {
  pub text: String,
  pub freigabe_in_app: bool,
  pub ohne_tan: bool,
}

#[derive(Serialize)]
pub struct Umsatz {
  pub datum: String,
  pub valuta: Option<String>,
  pub betrag: f64,
  pub verwendungszweck: String,
  pub gegenpartei: String,
  pub gegen_iban: String,
  pub vorgemerkt: bool,
}

#[derive(Serialize)]
pub struct Abruf {
  pub wartet: bool,
  pub system_id: Option<String>,
  pub umsaetze: Vec<Umsatz>,
  pub saldo: Option<f64>,
  pub saldo_datum: Option<String>,
}

fn fehler(e: fints::FinTSError) -> String {
  let t = e.to_string();
  if t.contains("Product") || t.contains("9078") || t.contains("Produkt") {
    return format!("Die Bank lehnt die Produkt-ID ab. Bitte in den Einstellungen die bei fints.org registrierte Produkt-ID eintragen. ({t})");
  }
  if t.contains("PIN") || t.contains("9931") || t.contains("9942") {
    return format!("Anmeldung abgelehnt: Benutzerkennung oder PIN falsch. ({t})");
  }
  t
}

const DIENST: &str = "NANO Verwaltung Online-Banking";

fn eintrag(konto: i64) -> Result<keyring::Entry, String> {
  keyring::Entry::new(DIENST, &format!("bankkonto-{konto}")).map_err(|e| format!("Schlüsselbund nicht verfügbar: {e}"))
}

/// Liegt für dieses Bankkonto eine PIN im Schlüsselbund?
#[tauri::command]
pub fn bank_pin_vorhanden(konto: i64) -> bool {
  eintrag(konto).and_then(|e| e.get_password().map_err(|e| e.to_string())).is_ok()
}

/// Gespeicherte PIN aus dem Schlüsselbund entfernen
#[tauri::command]
pub fn bank_pin_loeschen(konto: i64) -> Result<(), String> {
  match eintrag(konto)?.delete_credential() {
    Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
    Err(e) => Err(e.to_string()),
  }
}

#[tauri::command]
pub async fn bank_start(
  state: tauri::State<'_, BankState>,
  konto: i64,
  blz: String,
  benutzer: String,
  pin: Option<String>,
  merken: bool,
  system_id: Option<String>,
  produkt_id: String,
  iban: String,
  bic: String,
) -> Result<Start, String> {
  let iban_t = fints::Iban::new(&iban);
  let bic_t = fints::Bic::new(&bic);
  // Ohne eingegebene PIN die gespeicherte aus dem Schlüsselbund nehmen
  let pin_t = match pin.as_deref().filter(|p| !p.is_empty()) {
    Some(p) => p.to_string(),
    None => eintrag(konto)?.get_password().map_err(|_| "Für dieses Konto ist keine PIN gespeichert.".to_string())?,
  };
  let sys = system_id.filter(|s| !s.is_empty() && s != "0").map(|s| SystemId::new(&s));
  let (flow, info) = Flow::initiate(
    &blz,
    &UserId::new(&benutzer),
    &Pin::new(&pin_t),
    &ProductId::new(&produkt_id),
    sys.as_ref(),
    Some(&iban_t),
    Some(&bic_t),
  )
  .await
  .map_err(fehler)?;
  // Erst nach erfolgreicher Anmeldung speichern, damit keine falsche PIN im Schlüsselbund landet
  if merken && pin.is_some() {
    eintrag(konto)?.set_password(&pin_t).map_err(|e| format!("PIN konnte nicht im Schlüsselbund gespeichert werden: {e}"))?;
  }
  *state.0.lock().await = Some(flow);
  Ok(Start { text: info.challenge.as_str().to_string(), freigabe_in_app: info.decoupled, ohne_tan: info.no_tan_required })
}

#[tauri::command]
pub async fn bank_abholen(state: tauri::State<'_, BankState>, iban: String, bic: String, tage: u32) -> Result<Abruf, String> {
  let mut guard = state.0.lock().await;
  let flow = guard.as_mut().ok_or("Kein Abruf gestartet.")?;
  match flow.confirm_and_fetch(&iban, &bic, tage.min(730)).await {
    Ok(r) => {
      *guard = None;
      let umsaetze = r
        .transactions
        .into_iter()
        .map(|t| Umsatz {
          datum: t.date.to_string(),
          valuta: t.valuta_date.map(|d| d.to_string()),
          betrag: t.amount.to_string().parse().unwrap_or(0.0),
          verwendungszweck: t.purpose.unwrap_or_default(),
          gegenpartei: t.applicant_name.unwrap_or_default(),
          gegen_iban: t.applicant_iban.map(|i| i.as_str().to_string()).unwrap_or_default(),
          vorgemerkt: format!("{:?}", t.status).to_lowercase().contains("pending"),
        })
        .collect();
      Ok(Abruf {
        wartet: false,
        system_id: r.system_id.as_ref().filter(|s| s.is_assigned()).map(|s| s.as_str().to_string()),
        umsaetze,
        saldo: r.balance.as_ref().and_then(|b| b.amount.to_string().parse().ok()),
        saldo_datum: r.balance.as_ref().map(|b| b.date.to_string()),
      })
    }
    Err(e) => {
      let t = e.to_string();
      if t.contains("TAN still pending") {
        return Ok(Abruf { wartet: true, system_id: None, umsaetze: vec![], saldo: None, saldo_datum: None });
      }
      *guard = None;
      Err(fehler(e))
    }
  }
}

#[tauri::command]
pub async fn bank_abbrechen(state: tauri::State<'_, BankState>) -> Result<(), String> {
  *state.0.lock().await = None;
  Ok(())
}
