mod common;
mod tools;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            tools::xiaoai_login::xiaoai_open_login,
            tools::xiaoai_login::xiaoai_list_devices,
        ])
        .run(tauri::generate_context!())
        .expect("error while running sbot-helper");
}
