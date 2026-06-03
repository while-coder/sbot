# Channels

Sidebar → **Channels** → New

Select the channel type and fill in the credentials, then assign agent + saver + memory. Every user/group chat is isolated automatically.

## Supported Channels

| Type | Required fields |
|------|----------------|
| Lark / Feishu | App ID, App Secret |
| Slack | Bot Token (`xoxb-...`), App Token (`xapp-...`) |
| WeCom | Bot ID, Secret |
| WeChat | QR code login (credentials auto-populated) |
| OneBot (QQ) | WS Host, WS Port, optional Access Token |
| XiaoAI | Mi account ID, Password, Device name |

## Lark / Feishu

1. Create a bot app in the [Feishu Developer Console](https://open.feishu.cn) (or the [Lark Developer Console](https://open.larksuite.com/) for international)
2. Enable **Bot** capability
3. Grant the following permissions under **Permissions & Scopes** (or use **Batch Import** with the JSON below):

| Permission | Description |
|------------|-------------|
| `im:message:send_as_bot` | Send messages as bot |
| `im:message.p2p_msg:readonly` | Receive direct messages |
| `im:message.group_at_msg:readonly` | Receive group @bot messages |
| `im:message.group_msg` | Receive all group messages |
| `im:message:readonly` | Read message content |
| `im:chat:readonly` | Read chat/group info |
| `im:resource` | Read files and images in messages |
| `contact:user.base:readonly` | Read basic user info |
| `contact:contact.base:readonly` | Read basic contact info |

::: details Batch import JSON
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

4. Under **Events & Callbacks**, set the subscription mode to **Long Connection**
5. In Web UI → **Channels**, create a Lark channel and fill in **App ID** and **App Secret**

Supports event deduplication, interactive cards, per-user context isolation, and file/image send and receive.

## Slack

1. Create a Slack app at [api.slack.com/apps](https://api.slack.com/apps)
2. Enable **Socket Mode** and generate an App-Level Token (`xapp-...`) with the `connections:write` scope
3. Add bot scopes: `chat:write`, `im:history`, `im:read`, `app_mentions:read`, `channels:history`, `groups:history`, `files:read`
4. Install the app to your workspace and copy the **Bot User OAuth Token** (`xoxb-...`)
5. In Web UI → **Channels**, create a Slack channel and fill in both tokens

## WeCom

1. Create an AI app in the [WeCom Admin Console](https://work.weixin.qq.com) and obtain the **Bot ID** and **Secret**
2. In Web UI → **Channels**, create a WeCom channel and fill in Bot ID and Secret

Connects via WebSocket for real-time messaging, with file and image support.

## WeChat

1. In Web UI → **Channels**, create a WeChat channel
2. Click QR login and scan the code with WeChat to authenticate
3. Credentials are saved automatically once authenticated, and the channel goes live immediately

WeChat integration connects via the iLink Bot API, with file and image support.

## OneBot (QQ / Telegram bridges / etc.)

OneBot is the standard reverse-WS protocol used by [NapCat](https://napneko.github.io/), [Lagrange](https://lagrangedev.github.io/), and other QQ adapters.

1. In Web UI → **Channels**, create a OneBot channel and configure:

| Field | Description | Default |
|-------|-------------|---------|
| WS Host | WebSocket server bind host | `0.0.0.0` |
| WS Port | WebSocket server port | `6700` |
| Access Token | Optional token for authentication | empty |
| Require @mention in groups | Only respond when @bot in group chats | `true` |

2. Configure the OneBot client (NapCat / Lagrange / etc.) to connect via reverse WS to `ws://<sbot-host>:<wsPort>` with the same access token

## XiaoAI

Talk to your XiaoAi smart speaker as a sbot channel.

1. In Web UI → **Channels**, create a XiaoAI channel and fill in:

| Field | Description |
|-------|-------------|
| 小米 ID | Your Mi account ID |
| 密码 | Mi account password |
| 设备名称 | Target device name (matches a device in your account) |

2. The bot logs in to Mi Cloud, listens for voice messages on the device, and replies via TTS through the speaker
