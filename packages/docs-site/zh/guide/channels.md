# 渠道

侧栏 → **渠道** → 新建

选择渠道类型，填写凭据，再分配 Agent + Saver + Memory。每个用户 / 群聊的会话自动隔离。

## 支持的渠道

| 类型 | 必填字段 |
|------|----------------|
| Lark / 飞书 | 部署域、App ID、App Secret |
| Slack | Bot Token（`xoxb-...`）、App Token（`xapp-...`） |
| 企业微信 WeCom | Bot ID、Secret |
| 微信 WeChat | 扫码登录（凭据自动获取） |
| 钉钉 DingTalk | Client ID、Client Secret |
| QQ（官方 Bot） | App ID、Client Secret |
| OneBot（QQ 完整协议） | WS Host、WS Port、可选 Access Token |
| 小爱 XiaoAI | 小米账号 ID、登录凭据、音箱名称 |

## Lark / 飞书

1. 在 [飞书开放平台](https://open.feishu.cn) 创建自建应用（国际版用 [Lark Developer Console](https://open.larksuite.com/)）
2. 开启 **机器人** 能力
3. 在 **权限管理** 中开通以下权限（也可在 **批量开通** 中导入下方 JSON）：

| 权限 | 说明 |
|------------|-------------|
| `im:message:send_as_bot` | 以机器人身份发送消息 |
| `im:message.p2p_msg:readonly` | 接收私聊消息 |
| `im:message.group_at_msg:readonly` | 接收群聊 @机器人 消息 |
| `im:message.group_msg` | 接收群聊所有消息 |
| `im:message:readonly` | 读取消息内容 |
| `im:chat:readonly` | 读取群信息 |
| `im:resource` | 读取消息中的文件和图片 |
| `contact:user.base:readonly` | 读取用户基本信息 |
| `contact:contact.base:readonly` | 读取通讯录基本信息 |

::: details 批量导入 JSON
```json
{
  "scopes": {
    "tenant": [
      "contact:contact.base:readonly",
      "contact:user.base:readonly",
      "im:chat:readonly",
      "im:message.group_at_msg:readonly",
      "im:message.group_msg",
      "im:message.p2p_msg:readonly",
      "im:message:readonly",
      "im:message:send_as_bot",
      "im:resource"
    ],
    "user": []
  }
}
```
:::

4. 在 **事件与回调** 中将订阅方式设置为 **长连接**
5. 在 Web UI → **渠道** 中创建 Lark 渠道，选择部署域，并填入 **App ID** 和 **App Secret**

支持事件去重、互动卡片、多用户上下文隔离，以及文件和图片的收发。

## Slack

1. 在 [api.slack.com/apps](https://api.slack.com/apps) 创建 Slack 应用
2. 启用 **Socket Mode**，生成带 `connections:write` 权限的 App-Level Token（`xapp-...`）
3. 添加 Bot Scope：`chat:write`、`im:history`、`im:read`、`app_mentions:read`、`channels:history`、`groups:history`、`files:read`
4. 把应用安装到工作区，并复制 **Bot User OAuth Token**（`xoxb-...`）
5. 在 Web UI → **渠道** 中创建 Slack 渠道，填入两个 Token

## 企业微信 WeCom

1. 在 [企业微信管理后台](https://work.weixin.qq.com) 创建智能应用，获取 **Bot ID** 和 **Secret**
2. 在 Web UI → **渠道** 中创建 WeCom 渠道，填入 Bot ID 和 Secret

通过 WebSocket 实时接收和回复消息，支持文件和图片收发。

## 微信 WeChat

1. 在 Web UI → **渠道** 中创建 WeChat 渠道
2. 点击扫码登录，使用微信扫描二维码完成认证
3. 认证成功后凭据自动保存，渠道立即上线

微信渠道基于 iLink Bot API 接入，支持文件和图片的收发。

## 钉钉 DingTalk

通过钉钉官方 **Stream 模式** 长连接接入，无需公网 IP / Webhook 服务器。

### 申请后台参数

1. 打开 [钉钉开放平台](https://open-dev.dingtalk.com/)
2. 进入 **应用开发 → 企业内部应用 → 创建应用**
3. 在 **应用能力 → 添加应用能力** 中添加 **机器人**
4. 在机器人设置中：
   - **消息接收模式** 选择 **Stream 模式**（流式接收）
   - 发布机器人
5. 在 **应用发布 → 版本管理与发布** 中创建一个新版本，填好基础信息后保存并发布
6. 回到 **基础信息 → 凭证与基础信息**，复制：
   - **Client ID**（即 AppKey）
   - **Client Secret**（即 AppSecret）

### 在 sbot 中创建渠道

在 Web UI → **渠道** 中创建 DingTalk 渠道，填入：

| 字段 | 说明 |
|------|------|
| Client ID | 应用的 Client ID（AppKey） |
| Client Secret | 应用的 Client Secret（AppSecret） |

### 与机器人对话

- **单聊**：在钉钉的搜索框搜索机器人名称 → 找到机器人 → 直接对话
- **群聊**：在群设置 → 机器人 → 添加机器人，添加后在群里 @ 机器人 即可触发

### 已知限制（标准模式）

- 钉钉普通 markdown 消息**无法原地编辑**，因此 Agent 流式输出会**累积到结束时一次性发出**（无打字机效果）。
- 不支持卡片按钮 / 表单回调（如需 Allow / Deny 审批按钮、Ask 表单交互，需切换 AI Card 模式，配置 `card_template_id` 后实现，本仓库尚未集成）。
- 暂不支持图片 / 文件的收发（钉钉 Open API 路径需另接 access_token + 阿里云 SDK）。

## QQ（官方开放平台 Bot）

直接对接 [QQ 开放平台](https://q.qq.com/) 的官方 Bot WebSocket Gateway，**不需要 NapCat / Lagrange**。如需个人号或更完整的 QQ 协议，请使用 OneBot 渠道。

### 申请后台参数

1. 打开 [QQ 开放平台](https://q.qq.com/)
2. 创建 **机器人应用** → 进入应用编辑页面
3. **回调配置**：
   - 在 **单聊事件** 中勾选 **C2C 消息事件**
   - 在 **群事件** 中勾选 **群消息事件 / AT 事件**
   - 确认配置
4. **沙箱配置 → 消息列表配置项**：点击 **添加成员**，把自己加进去
5. **开发管理** 页面获取：
   - **AppID**
   - **AppSecret**（即 Client Secret）
6. **IP 白名单**：添加运行 sbot 的服务器公网 IP（在终端执行 `curl ifconfig.me` 查看）。
   > 提示：使用魔搭创空间部署可填 `47.92.200.108`
7. 在沙箱配置中用 QQ 扫码，把机器人加到消息列表

### 在 sbot 中创建渠道

在 Web UI → **渠道** 中创建 QQ 渠道，填入：

| 字段 | 说明 |
|------|------|
| App ID | QQ 机器人 App ID |
| Client Secret | QQ 机器人 AppSecret |

### 与机器人对话

- **C2C 私聊**：通过沙箱测试列表中的 QQ 私聊，直接发消息
- **群聊**：把机器人添加到测试群后，在群中 **@机器人** 即可触发

### 已知限制（标准模式）

- **文本消息中不允许包含 URL**（QQ 平台限制）；本实现自动将 URL 替换为 `[链接已省略]`，不会让消息被驳回。
- 官方 Bot API **不支持原地编辑消息**，Agent 流式输出累积到结束时一次性发出。
- **不支持 Markdown 模板**（需在 QQ 平台单独申请 Markdown 权限和模板 ID）。
- **不支持卡片按钮 / 表单**：审批 / Ask 在 QQ 模式下没有交互 UI（按超时策略处理）。如需完整 QQ 体验请考虑 OneBot 渠道。
- 同一 `msg_id` 下的回复 **`msg_seq` 必须自增**，本实现已自动处理。

## OneBot（QQ / Telegram 桥接 等）

OneBot 是 [NapCat](https://napneko.github.io/)、[Lagrange](https://lagrangedev.github.io/) 等 QQ 适配器使用的标准反向 WS 协议。

1. 在 Web UI → **渠道** 中创建 OneBot 渠道并配置：

| 字段 | 说明 | 默认值 |
|-------|-------------|---------|
| WS Host | WebSocket 服务器绑定地址 | `0.0.0.0` |
| WS Port | WebSocket 服务器端口 | `6700` |
| Access Token | 可选认证 Token | 空 |
| 群聊需要 @ 机器人 | 群聊中只在被 @ 时回复 | `true` |

2. 配置 OneBot 客户端（NapCat / Lagrange 等）通过反向 WS 连接到 `ws://<sbot-host>:<wsPort>`，使用相同的 Access Token

## 小爱（XiaoAI）

把小爱智能音箱当作 sbot 渠道使用。

1. 在 Web UI → **渠道** 中创建 XiaoAI 渠道并填入：

| 字段 | 说明 |
|-------|-------------|
| 小米 ID | 小米账号 ID |
| 登录方式 | `passToken`（推荐，通过 **sbox** 获取），或小米账号密码 |
| 密码 / passToken | 与所选登录方式对应的凭据 |
| 登录设备 ID | 可选，PassportSDK 的 `deviceId`，通过 **sbox** 获取 |
| 设备名称 | 目标设备名（需与账号下的设备一致） |

2. 机器人登录到小米云，监听设备上的语音消息，并通过音箱 TTS 回复

::: tip 通过 sbox 获取 `passToken` 与 `deviceId`
小米账号在服务器上常因风控 / 二次验证导致密码登录失败，推荐用桌面工具箱 **sbox** 登录一次，再把它提取出的凭据填入上面的字段：

1. 从 [releases 页面](https://github.com/while-coder/sbox/releases/latest) 下载 **sbox** 并启动。
2. 打开 **小爱登录** 工具，在弹出窗口中完成小米账号登录。
3. sbox 会列出你的设备并显示 `passToken` 和 `deviceId`，复制填入上面的渠道字段即可。
:::
