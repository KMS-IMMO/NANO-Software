mod bank;
mod datenbank;
mod server;

use tauri_plugin_fs::FsExt;

/// Ablageordner (aus den Einstellungen) für den Dateizugriff freigeben; sonst nur Dokumente, Downloads, Schreibtisch und App-Daten
#[tauri::command]
fn ablage_freigeben(app: tauri::AppHandle, pfad: String) -> Result<(), String> {
  if pfad.trim().is_empty() { return Ok(()); }
  app.fs_scope().allow_directory(&pfad, true).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_opener::init())
    .manage(bank::BankState::default())
    .manage(datenbank::DbState::default())
    .invoke_handler(tauri::generate_handler![
      bank::bank_start, bank::bank_abholen, bank::bank_abbrechen, bank::bank_pin_vorhanden, bank::bank_pin_loeschen,
      datenbank::db_status, datenbank::db_einrichten, datenbank::db_oeffnen, datenbank::db_sperren,
      datenbank::db_passwort_aendern, datenbank::db_select, datenbank::db_select_lesend, datenbank::db_execute,
      datenbank::db_auto_sicherung, datenbank::db_sicherung_erstellen, datenbank::db_sicherungen, datenbank::db_wiederherstellen,
      ablage_freigeben, server::server_anfrage
    ])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while building tauri application");
}
