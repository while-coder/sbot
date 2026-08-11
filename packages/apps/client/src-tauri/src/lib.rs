#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(tauri_plugin_process::init());
    let builder = tauri_updater_kit::attach_updater(builder);

    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
