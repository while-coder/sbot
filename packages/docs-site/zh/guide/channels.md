# 渠道

侧栏 → **渠道** → 新建

选择渠道类型，填写凭据，再分配 Agent + Saver + Memory。每个用户 / 群聊的会话自动隔离。

## 支持的渠道

| 类型 | 必填字段 |
|------|----------------|
| Lark / 飞书 | App ID、App Secret |
| Slack | Bot Token（`xoxb-...`）、App Token（`xapp-...`） |
| 企业微信 WeCom | Bot ID、Secret |
| 微信 WeChat | 扫码登录（凭据自动获取） |
| OneBot（QQ） | WS Host、WS Port、可选 Access Token |
| 小爱 XiaoAI | 小米账号 ID、密码、设备名称 |

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
5. 在 Web UI → **渠道** 中创建 Lark 渠道，填入 **App ID** 和 **App Secret**

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
| 密码 | 小米账号密码 |
| 设备名称 | 目标设备名（需与账号下的设备一致） |

2. 机器人登录到小米云，监听设备上的语音消息，并通过音箱 TTS 回复
