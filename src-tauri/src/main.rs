#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod bridge;
mod catalog;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(bridge::AppState::default())
        .invoke_handler(tauri::generate_handler![
            bridge::get_catalog,
            bridge::inspect_input,
            bridge::start_conversion,
            bridge::cancel_conversion,
            bridge::retry_file_conversion
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
