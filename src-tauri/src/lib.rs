// Desktop-Hülle für den Radialhorn-Konfigurator. Die gesamte Logik läuft im Frontend;
// Rust stellt nur das Fenster bereit.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
