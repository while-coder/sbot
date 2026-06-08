mod common;
mod tools;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            tools::xiaoai_login::xiaoai_open_login,
            tools::xiaoai_login::xiaoai_logout,
            tools::xiaoai_login::xiaoai_list_devices,
            tools::keystore_gen::keystore_check_java,
            tools::keystore_gen::keystore_generate,
        ])
        .run(tauri::generate_context!())
        .expect("error while running sbot-helper");
}
