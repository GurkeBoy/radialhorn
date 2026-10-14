// Desktop-Hülle für den Radialhorn-Konfigurator. Die gesamte Logik läuft im Frontend;
// Rust stellt das Fenster bereit und speichert die Einstellungen als Datei.

use std::{fs, io::ErrorKind, path::PathBuf};
use tauri::Manager;

/// Einstellungsdateien, die das Frontend lesen und schreiben darf – nur diese Namen, keine
/// Pfade von außen. Getrennt für die Entwicklungs-App (`tauri dev`), damit sie die Einstellungen
/// der installierten App nicht verändert.
const SETTINGS_FILES: [&str; 2] = ["einstellungen.json", "einstellungen-dev.json"];

/// Pfad der Einstellungsdatei im Konfigurationsordner der App
/// (Windows: %APPDATA%\com.pilch.radialhorn).
fn settings_path(app: &tauri::AppHandle, name: &str) -> Result<PathBuf, String> {
    if !SETTINGS_FILES.contains(&name) {
        return Err(format!("unbekannte Einstellungsdatei: {name}"));
    }
    let dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    Ok(dir.join(name))
}

/// Inhalt der Einstellungsdatei, `None`, wenn es sie (noch) nicht gibt.
#[tauri::command]
async fn load_settings(app: tauri::AppHandle, name: String) -> Result<Option<String>, String> {
    let path = settings_path(&app, &name)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(Some(text)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: {e}", path.display())),
    }
}

/// Einstellungsdatei schreiben: erst in eine Zwischendatei, dann umbenennen – ein Absturz
/// mitten im Schreiben hinterlässt so die alte oder die neue Datei, nie eine halbe.
#[tauri::command]
async fn save_settings(app: tauri::AppHandle, name: String, json: String) -> Result<(), String> {
    let path = settings_path(&app, &name)?;
    let dir = path.parent().ok_or("kein Konfigurationsordner")?;
    fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| format!("{}: {e}", tmp.display()))?;
    fs::rename(&tmp, &path).map_err(|e| format!("{}: {e}", path.display()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![load_settings, save_settings])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
