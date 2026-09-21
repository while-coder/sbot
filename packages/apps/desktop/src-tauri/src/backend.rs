//! sbot 后端生命周期管理：
//! 启动时探测/拉起本地 sbot 服务，状态通过事件 + 快照双通道提供给前端，退出时优雅回收。

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

/// 与 packages/shared/shared/src/settings.ts 的 DEFAULT_PORT 保持一致
const DEFAULT_PORT: u16 = 5500;
const READY_TIMEOUT: Duration = Duration::from_secs(60);
const PROBE_INTERVAL: Duration = Duration::from_millis(500);

/// 当前运行中的后端实例（单实例应用，实际最多一个；owned=false 表示复用外部服务，退出时绝不回收）
static INSTANCES: Mutex<Vec<Arc<Backend>>> = Mutex::new(Vec::new());

pub struct Backend {
    pub port: u16,
    pub owned: bool,
    child: Mutex<Option<Child>>,
}

/// 后端状态快照：事件推送（sbot://status）与查询（get_backend_info）双保险的数据源
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackendState {
    pub phase: String,
    pub port: Option<u16>,
    pub owned: bool,
    pub base_url: String,
    pub message: String,
    pub log: Option<String>,
}

impl BackendState {
    pub fn starting() -> Self {
        Self {
            phase: "starting".into(),
            port: None,
            owned: false,
            base_url: String::new(),
            message: "正在启动…".into(),
            log: None,
        }
    }
}

/// 更新状态快照并广播事件（前端先订阅再查询，无论谁先到达都不丢状态）
fn update_state(
    app: &AppHandle,
    phase: &str,
    port: Option<u16>,
    owned: bool,
    message: &str,
    log: Option<String>,
) {
    let state = BackendState {
        phase: phase.into(),
        port,
        owned,
        base_url: port.map(|p| format!("http://127.0.0.1:{p}")).unwrap_or_default(),
        message: message.into(),
        log,
    };
    if let Some(mutex) = app.try_state::<Mutex<BackendState>>() {
        *mutex.lock().unwrap() = state.clone();
    }
    let _ = app.emit("sbot://status", &state);
}

/// get_backend_info 命令：返回当前状态快照
pub fn get_backend_info(app: &AppHandle) -> BackendState {
    app.try_state::<Mutex<BackendState>>()
        .map(|m| m.lock().unwrap().clone())
        .unwrap_or_else(BackendState::starting)
}

/// setup 阶段调用：起线程完成后端探测/拉起，不阻塞事件循环（前端显示 SplashGate）
pub fn start_async(app: AppHandle) {
    std::thread::spawn(move || match start_backend(&app) {
        Ok(backend) => {
            INSTANCES.lock().unwrap().push(backend.clone());
            let port = backend.port;
            let message = if backend.owned {
                format!("已启动 sbot 服务（端口 {port}）")
            } else {
                format!("已连接本机 sbot 服务（端口 {port}）")
            };
            update_state(&app, "ready", Some(port), backend.owned, &message, None);
        }
        Err(message) => {
            eprintln!("[sbot-desktop] backend start failed: {message}");
            update_state(&app, "failed", None, false, &message, None);
        }
    });
}

/// RunEvent::Exit 时调用：只回收本应用拉起的实例
pub fn shutdown_all() {
    for backend in INSTANCES.lock().unwrap().drain(..) {
        backend.shutdown_blocking();
    }
}

fn start_backend(app: &AppHandle) -> Result<Arc<Backend>, String> {
    let no_reuse = std::env::var("SBOT_DESKTOP_NO_REUSE").ok().is_some_and(|v| v != "0");
    if !no_reuse {
        update_state(app, "starting", None, false, "正在探测本机 sbot 服务…", None);
        if let Some(port) = detect_existing() {
            update_state(
                app,
                "reusing",
                Some(port),
                false,
                &format!("已连接本机 sbot 服务（端口 {port}）"),
                None,
            );
            return Ok(Arc::new(Backend {
                port,
                owned: false,
                child: Mutex::new(None),
            }));
        }
    }

    let port = free_port().map_err(|e| format!("分配空闲端口失败：{e}"))?;
    update_state(
        app,
        "starting",
        None,
        false,
        &format!("正在启动 sbot 服务（端口 {port}）…"),
        None,
    );

    let (child, stderr_tail) = spawn_backend(app, port)?;
    let backend = Arc::new(Backend {
        port,
        owned: true,
        child: Mutex::new(Some(child)),
    });
    // 先注册再等待就绪：等待期间关闭窗口也能从 INSTANCES 拿到句柄做回收
    INSTANCES.lock().unwrap().push(backend.clone());

    {
        let mut guard = backend.child.lock().unwrap();
        let child = guard.as_mut().expect("child 已注册");
        wait_ready(port, child, &stderr_tail)?;
    }
    Ok(backend)
}

/// 探测候选端口上是否已有 sbot 在跑（用户 CLI 装的服务），命中则直接复用
fn detect_existing() -> Option<u16> {
    for port in candidate_ports() {
        if let Some(resp) = http_request(port, "GET", "/api/about", &HashMap::new(), None) {
            if is_sbot_response(&resp) {
                return Some(port);
            }
        }
    }
    None
}

/// 候选端口：settings.json 里配置的 httpPort（可能被用户改过）+ 默认 5500
fn candidate_ports() -> Vec<u16> {
    let mut ports = Vec::new();
    if let Some(p) = read_settings_http_port() {
        ports.push(p);
    }
    ports.push(DEFAULT_PORT);
    ports.dedup();
    ports
}

/// 与 packages/backend/sbot/src/Core/Config.ts 对齐：dev 模式配置目录为 ~/.sbot-dev
fn sbot_config_dir() -> Option<PathBuf> {
    let home = home_dir()?;
    let dir = if cfg!(debug_assertions) { ".sbot-dev" } else { ".sbot" };
    Some(home.join(dir))
}

fn home_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE").ok().map(PathBuf::from)
    }
    #[cfg(not(windows))]
    {
        std::env::var("HOME").ok().map(PathBuf::from)
    }
}

fn read_settings_http_port() -> Option<u16> {
    let path = sbot_config_dir()?.join("settings.json");
    let text = std::fs::read_to_string(path).ok()?;
    let value: serde_json::Value = serde_json::from_str(&text).ok()?;
    value.get("httpPort")?.as_u64().map(|p| p as u16)
}

fn free_port() -> std::io::Result<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();
    drop(listener);
    Ok(port)
}

fn spawn_backend(app: &AppHandle, port: u16) -> Result<(Child, Arc<Mutex<Vec<String>>>), String> {
    let stderr_tail: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));

    let (mut cmd, cwd) = if cfg!(debug_assertions) {
        // dev：系统 node + monorepo debug 产物（tsconfig.debug.json 直接映射 src → debug/index.js）
        let debug_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/backend/sbot/debug");
        if !debug_dir.join("index.js").is_file() {
            return Err("未找到 sbot debug 产物，请先运行 pnpm run debug:sbot".into());
        }
        let mut cmd = Command::new("node");
        cmd.arg("index.js");
        (cmd, debug_dir)
    } else {
        // release：捆绑的 node sidecar + resources/sbot
        // （资源树 = sbot 发布根：tsc 产物在 dist/，webui/skills 在根下，与 Dockerfile 同构）
        let resource_dir = sbot_resource_dir(app)?;
        let mut cmd = Command::new(node_sidecar_path()?);
        cmd.arg("dist/index.js");
        (cmd, resource_dir)
    };

    cmd.current_dir(&cwd)
        .env("SBOT_HTTP_PORT", port.to_string())
        .env("SBOT_HTTP_HOST", "127.0.0.1")
        .env("SBOT_DESKTOP", "1")
        .stdout(Stdio::null())
        .stderr(Stdio::piped());

    if cfg!(debug_assertions) {
        cmd.env("NODE_ENV", "development");
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(unix)]
    {
        // 独立进程组：硬杀时可 killpg 整组回收（含 node-pty 派生的 shell）
        cmd.process_group(0);
    }

    let mut child = cmd.spawn().map_err(|e| format!("启动 sbot 进程失败：{e}"))?;

    // 收集 stderr 最近 50 行，失败时展示给用户
    if let Some(stderr) = child.stderr.take() {
        let tail = stderr_tail.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let mut buf = tail.lock().unwrap();
                buf.push(line);
                let len = buf.len();
                if len > 50 {
                    buf.drain(..len - 50);
                }
            }
        });
    }

    #[cfg(windows)]
    assign_job_object(&mut child);

    Ok((child, stderr_tail))
}

/// release 模式下 resources/sbot 的位置：与 tauri.conf.json bundle.resources 的映射一致
fn sbot_resource_dir(app: &AppHandle) -> Result<PathBuf, String> {
    if let Ok(dir) = std::env::var("SBOT_DESKTOP_RESOURCE_DIR") {
        return Ok(PathBuf::from(dir));
    }
    app.path()
        .resource_dir()
        .map(|dir| dir.join("sbot"))
        .map_err(|_| "无法定位资源目录".to_string())
}

/// externalBin 打包后位于主程序同目录，命名 node-<triple>[.exe]
fn node_sidecar_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| format!("无法定位主程序：{e}"))?;
    let name = if cfg!(windows) {
        format!("node-{}.exe", target_triple())
    } else {
        format!("node-{}", target_triple())
    };
    let path = exe.parent().ok_or("无法定位主程序目录")?.join(name);
    if !path.is_file() {
        return Err(format!("未找到捆绑的 Node 运行时：{}", path.display()));
    }
    Ok(path)
}

fn target_triple() -> &'static str {
    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "x86_64-pc-windows-msvc"
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "aarch64-apple-darwin"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "x86_64-apple-darwin"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "x86_64-unknown-linux-gnu"
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        "aarch64-unknown-linux-gnu"
    } else {
        "unknown"
    }
}

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// 把子进程绑定到 KILL_ON_JOB_CLOSE 的 Job Object 并故意泄漏句柄：
/// launcher 无论正常退出还是崩溃，内核关闭句柄时都会回收整棵进程树（防 node-pty shell 残留的主防线）
#[cfg(windows)]
fn assign_job_object(child: &mut Child) {
    use std::os::windows::io::AsRawHandle;
    let mut info = win32job::ExtendedLimitInfo::new();
    info.limit_kill_on_job_close();
    if let Ok(job) = win32job::Job::create_with_limit_info(&info) {
        let _ = job.assign_process(child.as_raw_handle() as _);
        std::mem::forget(job);
    }
}

fn wait_ready(
    port: u16,
    child: &mut Child,
    stderr_tail: &Arc<Mutex<Vec<String>>>,
) -> Result<(), String> {
    let deadline = Instant::now() + READY_TIMEOUT;
    while Instant::now() < deadline {
        if let Some(resp) = http_request(port, "GET", "/api/about", &HashMap::new(), None) {
            if is_sbot_response(&resp) {
                return Ok(());
            }
        }
        if let Ok(Some(status)) = child.try_wait() {
            let log = stderr_tail.lock().unwrap().join("\n");
            return Err(format!("sbot 进程提前退出（{status}）\n{log}"));
        }
        std::thread::sleep(PROBE_INTERVAL);
    }
    let log = stderr_tail.lock().unwrap().join("\n");
    Err(format!("sbot 服务启动超时\n{log}"))
}

/// 最小 HTTP 客户端（避免引入 reqwest）：仅用于探活/身份校验/优雅关停，返回原始响应文本
fn http_request(
    port: u16,
    method: &str,
    path: &str,
    headers: &HashMap<&str, &str>,
    body: Option<&str>,
) -> Option<String> {
    let mut stream = TcpStream::connect_timeout(
        &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
        Duration::from_millis(800),
    )
    .ok()?;
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .ok()?;

    let mut req = format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n");
    let body = body.unwrap_or("");
    if !body.is_empty() {
        req.push_str(&format!("Content-Length: {}\r\n", body.len()));
    }
    for (k, v) in headers {
        req.push_str(&format!("{k}: {v}\r\n"));
    }
    req.push_str("\r\n");
    req.push_str(body);

    stream.write_all(req.as_bytes()).ok()?;
    let mut resp = String::new();
    stream.read_to_string(&mut resp).ok()?;
    Some(resp)
}

/// 身份校验：/api/about 返回 200 且 name 含 sbot（避免误复用占用端口的其他服务）
fn is_sbot_response(resp: &str) -> bool {
    let status_ok = resp.lines().next().is_some_and(|line| line.contains(" 200 "));
    status_ok && resp.contains("sbot")
}


impl Backend {
    /// 退出回收（仅 owned 实例）：POST /api/shutdown 优雅关停 → 信号 → 强杀，逐级升级
    fn shutdown_blocking(&self) {
        if !self.owned {
            return;
        }
        let mut child = match self.child.lock().unwrap().take() {
            Some(c) => c,
            None => return,
        };

        let headers = HashMap::from([("X-Sbot-Shutdown-Source", "desktop")]);
        let _ = http_request(self.port, "POST", "/api/shutdown", &headers, None);

        let deadline = Instant::now() + Duration::from_secs(8);
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let _ = Command::new("taskkill")
                .args(["/PID", &child.id().to_string(), "/T", "/F"])
                .creation_flags(CREATE_NO_WINDOW)
                .status();
        }
        #[cfg(unix)]
        unsafe {
            libc::killpg(child.id() as libc::pid_t, libc::SIGTERM);
        }

        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if matches!(child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}
