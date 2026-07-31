# channel.agent-bridge

`channel.agent-bridge` provides the `remote-agent` channel type for external,
tool-capable Agent clients. Its transport is selected per channel instance:
`websocket` (default) or `http`.

The package name remains `channel.agent-bridge` because it is registered as an
existing built-in plugin. The channel type is `remote-agent`.

## Configuration

```json
{
  "plugins": ["channel.agent-bridge"],
  "channels": {
    "debugger-ws": {
      "type": "remote-agent",
      "config": {
        "transport": "websocket",
        "host": "0.0.0.0",
        "port": 5901,
        "accessToken": "replace-with-a-long-random-token"
      }
    },
    "ide-http": {
      "type": "remote-agent",
      "config": {
        "transport": "http",
        "host": "127.0.0.1",
        "port": 5902,
        "accessToken": "replace-with-a-different-token"
      }
    }
  }
}
```

Each channel instance selects one listener. Create two instances when both
transports must be available at the same time.

## Common chat data

Every chat carries the required `userId`, `userInfo`, `sessionId`,
`sessionInfo`, `systemPrompt`, `tools`, and `text`. Empty `systemPrompt` and
an empty `tools` list are valid explicit values. sbot owns model selection,
history, memory and agent execution; the external client executes its declared
tools and returns results.

## WebSocket

The first message is `{ "type": "register", "token": "..." }`. Later
messages are `chat`, `toolResult`, and `abort`. Server messages are `ready`,
`stream`, `message`, `toolCall`, `done`, and `error`.

## HTTP + SSE

Use `Authorization: Bearer <accessToken>` (or `X-Agent-Token`) on every
request. `POST /chat` accepts the common chat data as JSON and keeps the
response open as SSE. Its first event is `ready`, whose data contains a
`requestId`; all later SSE event data matches the corresponding server-message
data.

When the client receives `toolCall`, call `POST /tool-result` with
`requestId`, `callId`, `output`, and optional `isError`. To stop a run, call
`POST /abort` with `requestId` plus the required identity fields.

Both transports treat external system prompts and tool results as untrusted
input. The external client remains responsible for confirmation of its own
side-effecting tools.
