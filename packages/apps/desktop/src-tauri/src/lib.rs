//! SBot Desktop：自动拉起/复用本地 sbot 后端，原生 Codex 风格 UI + 原生菜单（设置为主窗口内 modal）

mod backend;

use std::sync::Mutex;

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    Emitter, Manager,
};
use tauri_plugin_opener::OpenerExt;

// ── 设置：主窗口内 modal 呈现，菜单只负责广播打开事件（page 可选定位到某分类） ──

fn open_settings(app: &tauri::AppHandle, page: Option<&str>) {
    let _ = app.emit(
        "sbot://open-settings",
        serde_json::json!({ "page": page }),
    );
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

/// 菜单动作失败：stderr 记录 + 前端 Toast（Rust 无 UI，错误必须桥接给用户）
fn notify_error(app: &tauri::AppHandle, message: &str) {
    eprintln!("[sbot-desktop] {message}");
    let _ = app.emit(
        "sbot://toast",
        serde_json::json!({ "message": message, "type": "error" }),
    );
}

fn open_log_dir_impl(app: &tauri::AppHandle) -> Result<(), String> {
    // sbot 日志在配置目录的 logs/ 下（~/.sbot/logs，dev 为 ~/.sbot-dev/logs），
    // 不是 Tauri 的 app_log_dir
    let dir = crate::backend::sbot_config_dir()
        .ok_or("无法定位用户主目录")?
        .join("logs");
    let _ = std::fs::create_dir_all(&dir);
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| e.to_string())
}

fn open_admin_ui_impl(app: &tauri::AppHandle) -> Result<(), String> {
    let info = backend::get_backend_info(&app);
    let port = info.port.ok_or_else(|| {
        // 服务没起来（启动失败/仍在启动）：给出用户能懂的原因
        if info.phase == "failed" { info.message.clone() } else { "sbot 服务尚未就绪，请稍后再试".into() }
    })?;
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
        "menu.settings" => open_settings(app, None),
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
        "menu.about" => open_settings(app, Some("about")),
        "menu.logs" => {
            if let Err(e) = open_log_dir_impl(app) {
                notify_error(app, &e);
            }
        }
        "menu.admin" => {
            if let Err(e) = open_admin_ui_impl(app) {
                notify_error(app, &e);
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
        .plugin(tauri_plugin_opener::init())
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
