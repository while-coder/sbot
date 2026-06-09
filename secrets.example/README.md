# Secrets

本地开发用的密钥、密码文件放在仓库根目录的 `secrets/`，被 `.gitignore` 排除，**绝不提交**。
本目录 (`secrets.example/`) 只存放模板和说明，可提交。

CI 不读 `secrets/` 里的文件，改由 GitHub Actions Secrets 注入环境变量。

---

## 目录布局

```
secrets/                           # gitignored
├── release.jks                    # Android 签名 keystore
├── keystore.properties            # Android 签名密码（拷贝自模板）
├── tauri-updater.key              # Tauri Updater 私钥（minisign）
└── tauri-updater.key.pub          # Tauri Updater 公钥
```

---

## 本地开发配置

### 一键生成（首次配置）

Git Bash 里跑这一段，输入 alias 和密码即可：

```bash
mkdir -p secrets && \
read -p "Android key alias: " ALIAS && \
read -s -p "Android keystore password: " PASS && echo && \
keytool -genkeypair -v \
  -keystore secrets/release.jks \
  -alias "$ALIAS" \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" \
  -dname "CN=sbot, OU=dev, O=qingfeng346, L=., S=., C=CN" && \
cp secrets.example/keystore.properties.example secrets/keystore.properties && \
sed -i "s|^keyAlias=.*|keyAlias=$ALIAS|; s|^storePassword=.*|storePassword=$PASS|; s|^keyPassword=.*|keyPassword=$PASS|" secrets/keystore.properties && \
pnpm --filter @sbot/app exec tauri signer generate -w ../../secrets/tauri-updater.key -p "" --ci
```

跑完会得到 `release.jks` / `keystore.properties` / `tauri-updater.key{,.pub}`。

> ⚠️ **`release.jks` 已存在时**先 `rm secrets/release.jks` 再跑，否则 keytool 会往现有文件追加 entry。
>
> ⚠️ **`tauri-updater.key` 别重新生成**——除非同步替换 `packages/app/src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`，否则旧版本 app 会全部更新失败。已有现网用户时跳过最后一行 `tauri signer generate`。

### 分步执行

需要单独执行某一步时参考下面。

**Android keystore：**

```bash
keytool -genkeypair -v \
  -keystore secrets/release.jks \
  -alias <你的-alias> \
  -keyalg RSA -keysize 2048 -validity 10000

cp secrets.example/keystore.properties.example secrets/keystore.properties
# 编辑 secrets/keystore.properties，填入 keyAlias / storePassword / keyPassword
```

**Tauri Updater：**

```bash
pnpm --filter @sbot/app exec tauri signer generate \
  -w ../../secrets/tauri-updater.key -p "" --ci
```

公钥需同步到 `packages/app/src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`，更换密钥后必须替换。

---

## CI 配置（GitHub Actions Secrets）

仓库 → **Settings → Secrets and variables → Actions → New repository secret**，逐项添加：

| Secret | 用途 | 来源 |
|---|---|---|
| `ANDROID_KEYSTORE_BASE64` | `release.jks` 的 base64 | 见下方 [生成 base64](#生成-base64) |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码 | 本地 `keystore.properties` |
| `ANDROID_KEY_ALIAS` | key alias | 本地 `keystore.properties` |
| `ANDROID_KEY_PASSWORD` | key 密码 | 本地 `keystore.properties` |
| `TAURI_SIGNING_PRIVATE_KEY` | `tauri-updater.key` 文件内容 | 本地私钥文件 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 私钥密码 | 生成时若未设可省略 |
| `NPM_TOKEN` | npm 发布 | 见下方 [npm](#npm_token) |
| `DOCKERHUB_USERNAME` | Docker Hub 用户名 | Docker Hub 账号 |
| `DOCKERHUB_TOKEN` | Docker Hub PAT | 见下方 [Docker Hub](#dockerhub_token) |
| `VSCE_PAT` | VSCode 插件市场发布 token | 见下方 [VSCE_PAT](#vsce_pat) |

### 生成 base64

```bash
base64 -w0 secrets/release.jks > release.jks.b64    # Linux / macOS
certutil -encode secrets/release.jks release.jks.b64  # Windows
```

### `NPM_TOKEN`

1. 登录 https://www.npmjs.com/ → 头像 → **Access Tokens**
2. **Generate New Token → Classic Token**，类型选 **Automation**（CI 专用，绕过 2FA）
3. 复制 token（只显示一次）

发布账号需对目标 scope（如 `@qingfeng346`）有 publish 权限。

### `DOCKERHUB_USERNAME`

Docker Hub 登录用户名（不是邮箱），即 `hub.docker.com/u/<username>` 里的 username。

### `DOCKERHUB_TOKEN`

1. 登录 https://hub.docker.com/ → 头像 → **Account settings → Personal access tokens**
2. **Generate new token**，权限选 **Read & Write**（push 镜像需要）
3. 复制 token（只显示一次）

CI 一律用 PAT，不要用账号密码。

### `VSCE_PAT`

发布 VSCode 插件到 Marketplace 用。Publisher 在 [marketplace.visualstudio.com/manage/publishers](https://marketplace.visualstudio.com/manage/publishers/) 注册，但 token 必须从 Azure DevOps 申请。

**前置条件**：必须有一个 Azure DevOps organization。没有 org 时所有 PAT 入口都会 404。

1. 打开 https://aex.dev.azure.com/me 看自己有没有 org：
   - **有**：记下 org 名（当前账号的 org 是 `qingfeng346`）
   - **没有**：页面会引导建一个；名字随便填，Region 选 `Asia Pacific`，建完会跳到 `https://dev.azure.com/<org>`
2. 打开 PAT 页面：https://dev.azure.com/qingfeng346/_usersSettings/tokens
   （URL 必须带 org 名，缺了就 404；其他 org 把 `qingfeng346` 替换掉即可）
3. 点 **+ New Token**，填：
   - **Name**：随便，比如 `vsce-publish`
   - **Organization**：下拉选 **All accessible organizations**（关键，否则 vsce 报 401）
   - **Expiration**：按需，最长 1 年
   - **Scopes**：选 **Custom defined** → 默认列表里没有 Marketplace，点底部 **Show all scopes** 展开 → 找到 **Marketplace** → 勾 `Manage`
4. **Create** → 立即复制 token（只显示一次，关掉就没了）

Publisher 必须先在 Marketplace 创建好（当前为 `while`），且 [packages/vscode-extension/package.json](../packages/vscode-extension/package.json) 的 `publisher` 字段要与之匹配。

token 过期后 `Release App` workflow 的 `publish-vscode` job 会失败，重新申请 PAT 并更新 secret 即可。

---

## 备份

`secrets/` 里的文件丢了**没有恢复办法**，至少冷备份到：

- 离线 U 盘
- 密码管理器（如 1Password / Bitwarden 的 attachments）
