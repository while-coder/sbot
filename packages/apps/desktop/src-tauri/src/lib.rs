//! SBot Desktop：自动拉起/复用本地 sbot 后端，原生 Codex 风格 UI + 原生菜单 + 独立设置窗口

mod backend;

use std::sync::Mutex;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    Emitter, Manager,
};
use tauri_plugin_opener::OpenerExt;

// ── 设置窗口初始页：窗口创建前写入，前端挂载时 invoke 取走（避免事件早于监听的竞态） ──

static SETTINGS_INITIAL_PAGE: Mutex<Option<String>> = Mutex::new(None);

fn open_settings_window_impl(app: &tauri::AppHandle, page: Option<String>) -> Result<(), String> {
    // 已存在：切页 + 聚焦
    if let Some(win) = app.get_webview_window("settings") {
        if let Some(page) = &page {
            let _ = app.emit_to(
                "settings",
                "settings://navigate",
                serde_json::json!({ "page": page }),
            );
        }
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }
    // 不存在：记录初始页 → 创建窗口（前端挂载时 invoke get_settings_initial_page 取走）
    *SETTINGS_INITIAL_PAGE.lock().unwrap() = page;
    let url = tauri::WebviewUrl::App("index.html".into());
    let win = tauri::WebviewWindowBuilder::new(app, "settings", url)
        .title("设置")
        .inner_size(980.0, 640.0)
        .min_inner_size(720.0, 484.0)
        .build()
        .map_err(|e| format!("打开设置窗口失败：{e}"))?;
    let _ = win.show();
    let _ = win.set_focus();
    // Windows/Linux 下 app 级菜单会出现在每个窗口，设置窗口不需要菜单栏
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    let _ = win.remove_menu();
    Ok(())
}

#[tauri::command]
fn open_settings_window(app: tauri::AppHandle, page: Option<String>) -> Result<(), String> {
    open_settings_window_impl(&app, page)
}

#[tauri::command]
fn get_settings_initial_page() -> Option<String> {
    SETTINGS_INITIAL_PAGE.lock().unwrap().take()
}

#[tauri::command]
fn get_backend_info(app: tauri::AppHandle) -> backend::BackendState {
    backend::get_backend_info(&app)
}

// ── 缩放（Tauri 无 predefined zoom 菜单项，自定义实现；单全局档位近似即可） ──

static ZOOM: Mutex<f64> = Mutex::new(1.0);

fn change_zoom(win: Option<&tauri::WebviewWindow>, delta: Option<f64>) {
    let Some(win) = win else { return };
    let mut zoom = ZOOM.lock().unwrap();
    *zoom = match delta {
        Some(d) => (*zoom + d).clamp(0.5, 2.0),
        None => 1.0,
    };
    let _ = win.set_zoom(*zoom);
}

// ── 帮助菜单动作 ──

fn open_log_dir_impl(app: &tauri::AppHandle) -> Result<(), String> {
    let dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let _ = std::fs::create_dir_all(&dir);
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

fn open_admin_ui_impl(app: &tauri::AppHandle) -> Result<(), String> {
    let info = backend::get_backend_info(&app);
    let port = info.port.ok_or("sbot 服务尚未就绪")?;
    let url = format!("http://127.0.0.1:{port}/webui/");
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_log_dir(app: tauri::AppHandle) -> Result<(), String> {
    open_log_dir_impl(&app)
}

#[tauri::command]
fn open_admin_ui(app: tauri::AppHandle) -> Result<(), String> {
    open_admin_ui_impl(&app)
}

// ── 原生菜单 ──

fn focused_window(app: &tauri::AppHandle) -> Option<tauri::WebviewWindow> {
    app.webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false))
}

#[cfg(debug_assertions)]
fn toggle_devtools(win: &tauri::WebviewWindow) {
    if win.is_devtools_open() {
        let _ = win.close_devtools();
    } else {
        let _ = win.open_devtools();
    }
}

fn build_menu(app: &tauri::AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    // 文件
    let settings = MenuItem::with_id(app, "menu.settings", "设置…", true, Some("CmdOrCtrl+Comma"))?;
    let quit = PredefinedMenuItem::quit(app, Some("退出"))?;
    let file = Submenu::with_items(
        app,
        "文件",
        true,
        &[&settings, &PredefinedMenuItem::separator(app)?, &quit],
    )?;

    // 编辑
    let edit = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("撤销"))?,
            &PredefinedMenuItem::redo(app, Some("重做"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("剪切"))?,
            &PredefinedMenuItem::copy(app, Some("复制"))?,
            &PredefinedMenuItem::paste(app, Some("粘贴"))?,
            &PredefinedMenuItem::select_all(app, Some("全选"))?,
        ],
    )?;

    // 视图
    let reload = MenuItem::with_id(app, "menu.reload", "重新加载", true, Some("CmdOrCtrl+R"))?;
    let zoom_in = MenuItem::with_id(app, "menu.zoom_in", "放大", true, Some("CmdOrCtrl+Equal"))?;
    let zoom_out = MenuItem::with_id(app, "menu.zoom_out", "缩小", true, Some("CmdOrCtrl+Minus"))?;
    let zoom_reset = MenuItem::with_id(app, "menu.zoom_reset", "重置缩放", true, Some("CmdOrCtrl+0"))?;
    let theme = MenuItem::with_id(app, "menu.theme", "切换主题", true, None::<&str>)?;

    // 开发者工具仅 debug 构建进入菜单（release 无 devtools feature）
    #[cfg(debug_assertions)]
    let devtools = MenuItem::with_id(app, "menu.devtools", "开发者工具", true, Some("CmdOrCtrl+Shift+I"))?;

    let view = {
        #[cfg(debug_assertions)]
        {
            Submenu::with_items(
                app,
                "视图",
                true,
                &[
                    &reload,
                    &PredefinedMenuItem::separator(app)?,
                    &zoom_in,
                    &zoom_out,
                    &zoom_reset,
                    &PredefinedMenuItem::separator(app)?,
                    &theme,
                    &PredefinedMenuItem::separator(app)?,
                    &devtools,
                ],
            )?
        }
        #[cfg(not(debug_assertions))]
        {
            Submenu::with_items(
                app,
                "视图",
                true,
                &[
                    &reload,
                    &PredefinedMenuItem::separator(app)?,
                    &zoom_in,
                    &zoom_out,
                    &zoom_reset,
                    &PredefinedMenuItem::separator(app)?,
                    &theme,
                ],
            )?
        }
    };

    // 帮助
    let about = MenuItem::with_id(app, "menu.about", "关于 SBot", true, None::<&str>)?;
    let logs = MenuItem::with_id(app, "menu.logs", "打开日志目录", true, None::<&str>)?;
    let admin = MenuItem::with_id(app, "menu.admin", "打开 Admin Web UI", true, None::<&str>)?;
    let help = Submenu::with_items(app, "帮助", true, &[&about, &logs, &admin])?;

    Menu::with_items(app, &[&file, &edit, &view, &help])
}

// ── 菜单事件路由：聚焦窗口优先，main 兜底；缩放/重载/日志/admin 在 Rust 侧直接完成 ──

fn handle_menu_event(app: &tauri::AppHandle, event: tauri::menu::MenuEvent) {
    let win = focused_window(app).or_else(|| app.get_webview_window("main"));
    match event.id().as_ref() {
        "menu.settings" => {
            if let Err(e) = open_settings_window_impl(app, None) {
                eprintln!("[sbot-desktop] {e}");
            }
        }
        "menu.reload" => {
            if let Some(win) = win {
                let _ = win.reload();
            }
        }
        "menu.zoom_in" => change_zoom(win.as_ref(), Some(0.1)),
        "menu.zoom_out" => change_zoom(win.as_ref(), Some(-0.1)),
        "menu.zoom_reset" => change_zoom(win.as_ref(), None),
        "menu.theme" => {
            let _ = app.emit("sbot://menu", serde_json::json!({ "action": "toggle-theme" }));
        }
        "menu.about" => {
            if let Err(e) = open_settings_window_impl(app, Some("about".into())) {
                eprintln!("[sbot-desktop] {e}");
            }
        }
        "menu.logs" => {
            if let Err(e) = open_log_dir_impl(app) {
                eprintln!("[sbot-desktop] {e}");
            }
        }
        "menu.admin" => {
            if let Err(e) = open_admin_ui_impl(app) {
                eprintln!("[sbot-desktop] {e}");
            }
        }
        #[cfg(debug_assertions)]
        "menu.devtools" => {
            if let Some(win) = win {
                toggle_devtools(&win);
            }
        }
        _ => {}
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // 二次启动：聚焦已有窗口，后端由首实例管理
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }))
        .setup(|app| {
            app.manage(Mutex::new(backend::BackendState::starting()));
            let menu = build_menu(app.handle())?;
            app.set_menu(menu)?;
            backend::start_async(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_backend_info,
            open_settings_window,
            get_settings_initial_page,
            open_log_dir,
            open_admin_ui,
        ])
        .on_menu_event(handle_menu_event)
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                backend::shutdown_all();
            }
        });
}
