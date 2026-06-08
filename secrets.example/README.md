# Secrets

仓库的 `secrets/` 目录存放本地开发用的密钥和密码文件，被 `.gitignore` 排除，**绝不提交**。
此目录 (`secrets.example/`) 仅存放模板与说明，可以提交。

## 目录布局

```
secrets/                           # gitignored
├── release.jks                    # Android 签名 keystore
├── keystore.properties            # Android 签名密码（拷贝自模板）
├── tauri-updater.key              # Tauri Updater 私钥（minisign）
└── tauri-updater.key.pub          # Tauri Updater 公钥
```

## 首次配置

### 1. Android 签名

```bash
cp secrets.example/keystore.properties.example secrets/keystore.properties
```

把 `release.jks` 放到 `secrets/`，编辑 `secrets/keystore.properties` 填入：
- `keyAlias`
- `storePassword`
- `keyPassword`

新建 keystore（仅首次）：

```bash
keytool -genkeypair -v \
  -keystore secrets/release.jks \
  -alias <你的-alias> \
  -keyalg RSA -keysize 2048 -validity 10000
```

### 2. Tauri Updater

```bash
pnpm --filter @sbot/app exec tauri signer generate \
  -w ../../secrets/tauri-updater.key -p "" --ci
```

公钥已写入 `packages/app/src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`，
更换密钥后需要同步替换。

## CI 配置

GitHub Actions 不读这些文件，改用 secrets 注入环境变量：

| GitHub Secret | 用途 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `release.jks` 的 base64 编码 |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码 |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key 密码 |
| `TAURI_SIGNING_PRIVATE_KEY` | `tauri-updater.key` 文件内容 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码（无密码可省略） |

生成 base64：

```bash
base64 -w0 secrets/release.jks > release.jks.b64   # Linux/macOS
certutil -encode secrets/release.jks release.jks.b64  # Windows
```

## 备份

`secrets/` 里的文件丢了**没有恢复办法**，至少冷备份到：
- 离线 U 盘
- 密码管理器（如 1Password / Bitwarden 的 attachments）
