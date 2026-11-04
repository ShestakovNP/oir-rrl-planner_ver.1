//! ОИР RRL Planner — native shell.
//!
//! All application logic lives in the web frontend (src/). The Rust side only
//! wires the official Tauri plugins:
//!   * sql    — local SQLite database in the app data folder;
//!   * dialog — native "Save as" / "Open" dialogs;
//!   * fs     — writing exported files (PDF, JSON, CSV) chosen by the user;
//!   * opener — opening map links (Yandex Maps, OSM) in the system browser;
//!   * http   — network requests to the allow-listed map, geocoding and
//!              elevation services (see capabilities/default.json);
//!   * updater — installs a newer build from the project's GitHub release after
//!              checking its signature (public key in tauri.conf.json);
//!   * process — restarts the app after an update.
//! No custom servers and no usage tracking of any kind.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .run(tauri::generate_context!())
        .expect("failed to start OIR RRL Planner");
}
