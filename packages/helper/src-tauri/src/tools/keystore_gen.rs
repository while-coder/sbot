use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

#[derive(Serialize)]
pub struct JavaCheck {
    pub available: bool,
    pub path: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DName {
    pub common_name: String,
    pub organizational_unit: Option<String>,
    pub organization: Option<String>,
    pub locality: Option<String>,
    pub state: Option<String>,
    pub country: Option<String>,
}

#[derive(Serialize)]
pub struct GenerateResult {
    pub path: String,
    pub base64: String,
    pub fingerprint_sha256: String,
    pub fingerprint_sha1: String,
}

#[tauri::command]
pub async fn keystore_check_java() -> JavaCheck {
    match which::which("keytool") {
        Ok(path) => JavaCheck {
            available: true,
            path: Some(path.to_string_lossy().into_owned()),
        },
        Err(_) => JavaCheck {
            available: false,
            path: None,
        },
    }
}

#[tauri::command(rename_all = "camelCase")]
pub async fn keystore_generate(
    path: String,
    alias: String,
    store_password: String,
    key_password: String,
    validity_days: u32,
    dname: DName,
) -> Result<GenerateResult, String> {
    if store_password.len() < 6 {
        return Err("keystore 密码至少 6 位".into());
    }
    if key_password.len() < 6 {
        return Err("key 密码至少 6 位".into());
    }
    if alias.trim().is_empty() {
        return Err("alias 不能为空".into());
    }
    if dname.common_name.trim().is_empty() {
        return Err("Common Name (CN) 不能为空".into());
    }

    let keytool = which::which("keytool")
        .map_err(|_| "未找到 keytool。请安装 JDK 17+ 后重试。".to_string())?;

    let target = PathBuf::from(&path);
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            std::fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
        }
    }
    if target.exists() {
        std::fs::remove_file(&target).map_err(|e| format!("删除已存在文件失败: {e}"))?;
    }

    let dname_str = format_dname(&dname);

    let output = Command::new(&keytool)
        .args([
            "-genkeypair",
            "-keystore",
            &path,
            "-storetype",
            "PKCS12",
            "-alias",
            &alias,
            "-keyalg",
            "RSA",
            "-keysize",
            "2048",
            "-validity",
            &validity_days.to_string(),
            "-storepass:env",
            "KS_STORE_PASS",
            "-keypass:env",
            "KS_KEY_PASS",
            "-dname",
            &dname_str,
            "-noprompt",
        ])
        .env("KS_STORE_PASS", &store_password)
        .env("KS_KEY_PASS", &key_password)
        .output()
        .map_err(|e| format!("调用 keytool 失败: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(format!(
            "keytool 退出码非零:\nstderr: {}\nstdout: {}",
            stderr.trim(),
            stdout.trim()
        ));
    }

    let bytes = std::fs::read(&target).map_err(|e| format!("读取生成的 keystore 失败: {e}"))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&bytes);

    let list_output = Command::new(&keytool)
        .args([
            "-list",
            "-v",
            "-keystore",
            &path,
            "-alias",
            &alias,
            "-storepass:env",
            "KS_STORE_PASS",
        ])
        .env("KS_STORE_PASS", &store_password)
        .output()
        .map_err(|e| format!("读取指纹失败: {e}"))?;

    let list_text = String::from_utf8_lossy(&list_output.stdout);
    let fp_sha256 = extract_fingerprint(&list_text, "SHA256:")
        .or_else(|| extract_fingerprint(&list_text, "SHA-256:"))
        .unwrap_or_default();
    let fp_sha1 = extract_fingerprint(&list_text, "SHA1:")
        .or_else(|| extract_fingerprint(&list_text, "SHA-1:"))
        .unwrap_or_default();

    Ok(GenerateResult {
        path,
        base64: b64,
        fingerprint_sha256: fp_sha256,
        fingerprint_sha1: fp_sha1,
    })
}

fn format_dname(d: &DName) -> String {
    let mut parts: Vec<String> = Vec::new();
    parts.push(format!("CN={}", escape_dname_value(&d.common_name)));
    if let Some(v) = d.organizational_unit.as_deref().filter(|s| !s.trim().is_empty()) {
        parts.push(format!("OU={}", escape_dname_value(v)));
    }
    if let Some(v) = d.organization.as_deref().filter(|s| !s.trim().is_empty()) {
        parts.push(format!("O={}", escape_dname_value(v)));
    }
    if let Some(v) = d.locality.as_deref().filter(|s| !s.trim().is_empty()) {
        parts.push(format!("L={}", escape_dname_value(v)));
    }
    if let Some(v) = d.state.as_deref().filter(|s| !s.trim().is_empty()) {
        parts.push(format!("ST={}", escape_dname_value(v)));
    }
    if let Some(v) = d.country.as_deref().filter(|s| !s.trim().is_empty()) {
        parts.push(format!("C={}", escape_dname_value(v)));
    }
    parts.join(", ")
}

fn escape_dname_value(v: &str) -> String {
    v.replace('\\', "\\\\")
        .replace(',', "\\,")
        .replace('+', "\\+")
        .replace('"', "\\\"")
        .replace('<', "\\<")
        .replace('>', "\\>")
        .replace(';', "\\;")
}

fn extract_fingerprint(text: &str, marker: &str) -> Option<String> {
    text.lines()
        .find(|l| l.contains(marker))
        .and_then(|l| l.split_once(marker).map(|(_, v)| v.trim().to_string()))
        .filter(|s| !s.is_empty())
}
