//! Bankabruf per FinTS 3.0 (PIN/TAN) mit Freigabe in der Banking-App (pushTAN / decoupled).
//! Ablauf: `bank_start` meldet sich an und löst die Freigabe aus, `bank_abholen` fragt so lange nach,
//! bis die Freigabe erteilt ist, und liefert dann die Umsätze. Die PIN wird nicht gespeichert.
use fints::{Flow, Pin, ProductId, UserId};
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

#[tauri::command]
pub async fn bank_start(
  state: tauri::State<'_, BankState>,
  blz: String,
  benutzer: String,
  pin: String,
  produkt_id: String,
  iban: String,
  bic: String,
) -> Result<Start, String> {
  let iban_t = fints::Iban::new(&iban);
  let bic_t = fints::Bic::new(&bic);
  let (flow, info) = Flow::initiate(
    &blz,
    &UserId::new(&benutzer),
    &Pin::new(&pin),
    &ProductId::new(&produkt_id),
    None,
    Some(&iban_t),
    Some(&bic_t),
  )
  .await
  .map_err(fehler)?;
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
        umsaetze,
        saldo: r.balance.as_ref().and_then(|b| b.amount.to_string().parse().ok()),
        saldo_datum: r.balance.as_ref().map(|b| b.date.to_string()),
      })
    }
    Err(e) => {
      let t = e.to_string();
      if t.contains("TAN still pending") {
        return Ok(Abruf { wartet: true, umsaetze: vec![], saldo: None, saldo_datum: None });
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
