# Channels

Sidebar → **Channels** → New

Select the type and fill in the credentials, then assign agent + saver + memory. Every user/group chat is isolated automatically.

## Supported Channels

| Type | Required fields |
|------|----------------|
| Lark / Feishu | App ID, App Secret |
| Slack | Bot Token (`xoxb-...`), App Token (`xapp-...`) |
| WeCom | Bot ID, Secret |
| WeChat | QR code login (credentials auto-populated) |

## Lark / Feishu Setup

1. Create a bot app in the [Feishu Developer Console](https://open.feishu.cn)
2. Enable **Bot** capability
3. Grant required permissions:

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

4. Under **Events & Callbacks**, set the subscription mode to **Long Connection**
5. In Web UI → **Channels**, create a Lark channel and fill in **App ID** and **App Secret**

## WeCom Setup

1. Create an AI app in the [WeCom Admin Console](https://work.weixin.qq.com) and obtain the **Bot ID** and **Secret**
2. In Web UI → **Channels**, create a WeCom channel and fill in Bot ID and Secret

## WeChat Setup

1. In Web UI → **Channels**, create a WeChat channel
2. Click QR login and scan the code with WeChat to authenticate
3. Credentials are saved automatically once authenticated
