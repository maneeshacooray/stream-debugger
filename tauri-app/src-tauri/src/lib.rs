mod commands;

use commands::{AppState, register_commands};
use std::sync::Arc;
use tokio::sync::Mutex;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let devices = Arc::new(Mutex::new(std::collections::HashMap::new()));
    let credentials = Arc::new(Mutex::new(None));
    
    let builder = tauri::Builder::default()
        .manage(AppState { devices, credentials })
        .plugin(tauri_plugin_opener::init());

    register_commands(builder)
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
