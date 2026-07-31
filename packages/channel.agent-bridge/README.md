# channel.agent-bridge

`channel.agent-bridge` is a generic sbot channel for external Agent clients.
The client supplies a session key, optional task-specific `systemPrompt`, a
tool list and messages. sbot owns the configured model, agent loop, history,
and memory; the client owns execution and confirmation of its declared tools
and returns their results.

WMDebugger is one client of this protocol, not part of the channel contract.
An IDE, an operations console, or another product-specific tool surface can
use the same bridge without changing sbot.

## Enable during workspace development

Build the package, add `"channel.agent-bridge"` to `settings.plugins`, then
create a channel whose `type` is `"agent-bridge"`:

```json
{
  "plugins": ["channel.agent-bridge"],
  "channels": {
    "external-agent": {
      "type": "agent-bridge",
      "name": "External Agent",
      "config": {
        "host": "127.0.0.1",
        "port": 5901,
        "accessToken": "replace-with-a-long-random-token"
      }
    }
  }
}
```

The plugin owns a separate listener because the channel-plugin interface does
not expose sbot's private HTTP server. For remote access, bind a private
address and put a TLS-terminating reverse proxy in front; clients should then
use WSS.

## Protocol

The first message is `register` with `token`. Later messages are `chat`,
`toolResult`, and `abort`. Each `chat` carries the required `userId`,
`userInfo`, `sessionId`, and `sessionInfo`, then
resolves its own sbot session. One connection can therefore serve multiple
users and sessions. `abort` carries the same identity fields for routing.
`userInfo` and `sessionInfo` are JSON objects; their optional `name`
and `avatar` fields populate the sbot session display data.
Every `chat` must include `systemPrompt` and tool definitions; use an empty
string or an empty array when no task prompt or client tools apply.
Server events are `ready`,
`stream`, `message`, `toolCall`, `done`, and `error`.

Tool names must be valid identifier-style names and avoid collisions with sbot
built-in tools. The client must retain responsibility for permissions and user
confirmation of its own side-effecting tools.
