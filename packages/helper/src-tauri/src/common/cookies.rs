use std::collections::HashMap;
use tauri::webview::WebviewWindow;
use url::Url;

/// Read cookies for the given URL from the webview's native cookie store.
/// On macOS WKWebView / Windows WebView2 / Linux WebKitGTK this includes HttpOnly cookies —
/// those are the ones we typically want from auth flows.
pub fn cookies_map(window: &WebviewWindow, url: &Url) -> Result<HashMap<String, String>, String> {
    let cookies = window
        .cookies_for_url(url.clone())
        .map_err(|e| format!("read cookies failed: {e}"))?;
    Ok(cookies
        .into_iter()
        .map(|c| (c.name().to_string(), c.value().to_string()))
        .collect())
}
