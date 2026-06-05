use crate::common::{cookies::cookies_map, random::random_device_id};
use base64::Engine;
use digest::Digest;
use serde::Serialize;
use sha1::Sha1;
use std::collections::HashMap;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tokio::time::sleep;
use url::Url;

const SID: &str = "micoapi";
const PASSPORT_UA: &str = "Dalvik/2.1.0 (Linux; U; Android 10; RMX2111 Build/QP1A.190711.020) APP/xiaomi.mico APPV/2004040 MK/Uk1YMjExMQ== PassportSDK/3.8.3 passport-ui/3.8.3";
const MINA_UA: &str = "MiHome/6.0.103 (com.xiaomi.mihome; build:6.0.103.1; Android 14) Alamofire/2.0.1 Channel/stable";
const LOGIN_WINDOW_LABEL: &str = "xiaoai-login";

#[derive(Serialize, Clone)]
pub struct XiaoaiCreds {
    #[serde(rename = "userId")]
    pub user_id: String,
    #[serde(rename = "passToken")]
    pub pass_token: String,
    #[serde(rename = "deviceId")]
    pub device_id: String,
}

#[derive(Serialize)]
pub struct XiaoaiDevice {
    #[serde(rename = "deviceID")]
    pub device_id: String,
    #[serde(rename = "miotDID")]
    pub miot_did: String,
    pub name: String,
    pub alias: String,
}

// ─────────────────────────────────────────────────────────────────────────────
// Command 1: open the Xiaomi login page in a webview, wait for cookies.
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn xiaoai_open_login(app: AppHandle) -> Result<XiaoaiCreds, String> {
    let login_url: Url =
        "https://account.xiaomi.com/pass/serviceLogin?sid=micoapi&_locale=zh_CN"
            .parse()
            .map_err(|e: url::ParseError| e.to_string())?;
    let domain_url: Url = "https://account.xiaomi.com/".parse().unwrap();

    if let Some(existing) = app.get_webview_window(LOGIN_WINDOW_LABEL) {
        existing.close().ok();
        sleep(Duration::from_millis(200)).await;
    }

    let window = WebviewWindowBuilder::new(
        &app,
        LOGIN_WINDOW_LABEL,
        WebviewUrl::External(login_url),
    )
    .title("登录小米账号")
    .inner_size(800.0, 900.0)
    .min_inner_size(600.0, 700.0)
    .build()
    .map_err(|e| format!("open webview failed: {e}"))?;

    let started = Instant::now();
    let timeout = Duration::from_secs(300);
    let interval = Duration::from_millis(500);

    loop {
        if started.elapsed() > timeout {
            window.close().ok();
            return Err("登录超时（5 分钟未完成）".into());
        }

        if app.get_webview_window(LOGIN_WINDOW_LABEL).is_none() {
            return Err("用户取消".into());
        }

        match cookies_map(&window, &domain_url) {
            Ok(map) => {
                if let (Some(uid), Some(token)) = (map.get("userId"), map.get("passToken")) {
                    let device_id = map
                        .get("deviceId")
                        .cloned()
                        .unwrap_or_else(random_device_id);
                    window.close().ok();
                    return Ok(XiaoaiCreds {
                        user_id: uid.clone(),
                        pass_token: token.clone(),
                        device_id,
                    });
                }
            }
            Err(e) => {
                log::debug!("cookies_for_url err: {e}");
            }
        }

        sleep(interval).await;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Command 2: clear webview cookies / storage so the next login can use a
// different Xiaomi account. Without this, the embedded WebView would silently
// reuse the previous session.
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn xiaoai_logout(app: AppHandle) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window(LOGIN_WINDOW_LABEL) {
        existing.close().ok();
        sleep(Duration::from_millis(200)).await;
    }

    let window = WebviewWindowBuilder::new(
        &app,
        LOGIN_WINDOW_LABEL,
        WebviewUrl::External("about:blank".parse().unwrap()),
    )
    .visible(false)
    .inner_size(100.0, 100.0)
    .build()
    .map_err(|e| format!("create logout webview failed: {e}"))?;

    let result = window.clear_all_browsing_data();
    sleep(Duration::from_millis(100)).await;
    window.close().ok();

    result.map_err(|e| format!("clear browsing data failed: {e}"))?;
    Ok(())
}

// ─────────────────────────────────────────────────────────────────────────────
// Command 3: list mina devices using the captured passToken.
//   1. /pass/serviceLogin with passToken cookie → get { location, nonce, ssecurity }
//   2. Walk redirect chain → harvest serviceToken cookie
//   3. GET https://api2.mina.mi.com/admin/v2/device_list with serviceToken
// ─────────────────────────────────────────────────────────────────────────────

#[tauri::command(rename_all = "camelCase")]
pub async fn xiaoai_list_devices(
    user_id: String,
    pass_token: String,
    device_id: String,
) -> Result<Vec<XiaoaiDevice>, String> {
    let auth_client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(PASSPORT_UA)
        .build()
        .map_err(|e| e.to_string())?;
    let mina_client = reqwest::Client::builder()
        .user_agent(MINA_UA)
        .build()
        .map_err(|e| e.to_string())?;

    let mut jar: HashMap<String, String> = HashMap::new();
    jar.insert("userId".into(), user_id.clone());
    jar.insert("deviceId".into(), device_id.clone());
    jar.insert("sdkVersion".into(), "3.9".into());
    jar.insert("passToken".into(), pass_token.clone());

    let pass = service_login(&auth_client, &mut jar).await?;
    let location = pass
        .get("location")
        .and_then(|v| v.as_str())
        .ok_or("serviceLogin: missing location (passToken 可能已失效)")?
        .to_string();
    let nonce = pass
        .get("nonce")
        .and_then(stringy)
        .ok_or("serviceLogin: missing nonce")?;
    let ssecurity = pass
        .get("ssecurity")
        .and_then(stringy)
        .ok_or("serviceLogin: missing ssecurity")?;

    let service_token = fetch_service_token(&auth_client, &mut jar, &location, &nonce, &ssecurity).await?;
    jar.insert("serviceToken".into(), service_token);

    fetch_devices(&mina_client, &jar).await
}

// ─── HTTP helpers ────────────────────────────────────────────────────────────

fn cookie_header(jar: &HashMap<String, String>) -> String {
    jar.iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("; ")
}

fn merge_set_cookies(jar: &mut HashMap<String, String>, resp: &reqwest::Response) {
    for c in resp.headers().get_all(reqwest::header::SET_COOKIE).iter() {
        if let Ok(s) = c.to_str() {
            if let Some(pair) = s.split(';').next() {
                if let Some((k, v)) = pair.split_once('=') {
                    jar.insert(k.trim().to_string(), v.trim().to_string());
                }
            }
        }
    }
}

fn stringy(v: &serde_json::Value) -> Option<String> {
    match v {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// Xiaomi auth responses come back as `&&&START&&&{json}`, often with very large
/// numbers that JSON parsers truncate as f64. Strip the prefix and quote runs of
/// 9+ consecutive digits in `:value` positions before parsing.
fn parse_auth_response(text: &str) -> Result<serde_json::Value, String> {
    let trimmed = text.trim_start_matches("&&&START&&&");
    let mut out = String::with_capacity(trimmed.len() + 16);
    let bytes = trimmed.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b':' {
            let mut j = i + 1;
            while j < bytes.len() && bytes[j].is_ascii_digit() { j += 1; }
            let digits = j - i - 1;
            if digits >= 9 {
                out.push(':');
                out.push('"');
                out.push_str(&trimmed[i + 1..j]);
                out.push('"');
                i = j;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    serde_json::from_str(&out).map_err(|e| format!("parse auth response: {e}"))
}

async fn service_login(
    client: &reqwest::Client,
    jar: &mut HashMap<String, String>,
) -> Result<serde_json::Value, String> {
    let resp = client
        .get("https://account.xiaomi.com/pass/serviceLogin")
        .query(&[("sid", SID), ("_json", "true"), ("_locale", "zh_CN")])
        .header(reqwest::header::COOKIE, cookie_header(jar))
        .send()
        .await
        .map_err(|e| format!("serviceLogin: {e}"))?;
    merge_set_cookies(jar, &resp);
    let text = resp.text().await.map_err(|e| e.to_string())?;
    let body = parse_auth_response(&text)?;
    let code = body.get("code").and_then(|v| v.as_i64()).unwrap_or(-1);
    if code != 0 {
        let desc = body
            .get("description")
            .or_else(|| body.get("desc"))
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        return Err(format!("serviceLogin code={code} {desc}（passToken 可能已失效，请重新登录）"));
    }
    Ok(body)
}

fn client_sign(nonce: &str, ssecurity: &str) -> String {
    let raw = format!("nonce={nonce}&{ssecurity}");
    let mut hasher = Sha1::new();
    hasher.update(raw.as_bytes());
    let digest = hasher.finalize();
    base64::engine::general_purpose::STANDARD.encode(digest)
}

async fn fetch_service_token(
    client: &reqwest::Client,
    jar: &mut HashMap<String, String>,
    location: &str,
    nonce: &str,
    ssecurity: &str,
) -> Result<String, String> {
    let sign = client_sign(nonce, ssecurity);
    let mut next: Option<String> = Some(format!(
        "{location}&clientSign={}",
        urlencoding::encode(&sign)
    ));
    let mut hops = 0;
    while let Some(url) = next.take() {
        if hops > 10 {
            return Err("serviceToken: too many redirects".into());
        }
        hops += 1;
        let resp = client
            .get(&url)
            .header(reqwest::header::COOKIE, cookie_header(jar))
            .send()
            .await
            .map_err(|e| format!("serviceToken hop: {e}"))?;
        for c in resp.headers().get_all(reqwest::header::SET_COOKIE).iter() {
            if let Ok(s) = c.to_str() {
                if let Some(pair) = s.split(';').next() {
                    if let Some((k, v)) = pair.split_once('=') {
                        if k.trim() == "serviceToken" {
                            return Ok(v.trim().to_string());
                        }
                    }
                }
            }
        }
        merge_set_cookies(jar, &resp);
        let status = resp.status();
        if status.is_redirection() {
            if let Some(loc) = resp.headers().get(reqwest::header::LOCATION) {
                if let Ok(s) = loc.to_str() {
                    next = Some(s.to_string());
                    continue;
                }
            }
        }
    }
    Err("serviceToken not found in redirect chain".into())
}

async fn fetch_devices(
    client: &reqwest::Client,
    jar: &HashMap<String, String>,
) -> Result<Vec<XiaoaiDevice>, String> {
    let resp = client
        .get("https://api2.mina.mi.com/admin/v2/device_list")
        .query(&[("master", "1")])
        .header(reqwest::header::COOKIE, cookie_header(jar))
        .send()
        .await
        .map_err(|e| format!("device_list: {e}"))?;
    let body: serde_json::Value = resp.json().await.map_err(|e| format!("device_list parse: {e}"))?;
    let code = body.get("code").and_then(|v| v.as_i64()).unwrap_or(0);
    if code != 0 {
        let desc = body
            .get("message")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown");
        return Err(format!("device_list code={code} {desc}"));
    }
    let arr = body
        .get("data")
        .and_then(|v| v.as_array())
        .ok_or("device_list: missing data array")?;
    let mut out = Vec::with_capacity(arr.len());
    for d in arr {
        out.push(XiaoaiDevice {
            device_id: d.get("deviceID").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            miot_did: d.get("miotDID").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            name: d.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
            alias: d.get("alias").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        });
    }
    Ok(out)
}
