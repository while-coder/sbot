# channel.remote-agent

`channel.remote-agent` provides the `remote-agent` channel type for external,
tool-capable Agent clients. Its transport is selected per channel instance:
`websocket` (default) or `http`.

## Configuration

```json
{
  "plugins": ["channel.remote-agent"],
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
`sessionInfo`, `systemPrompt`, `tools`, and scorpio.ai-compatible `content`,
plus optional `workPath` and `attachments`. A non-empty `workPath` overrides
the workspace for that chat without changing the session profile or channel.
Attachments use `name` with `dataUrl` or text `content`. Images become multimodal input;
other attachments are written to a temporary file and injected as a file link.
Empty `systemPrompt` and an empty `tools` list are valid explicit values. sbot
owns model selection, history, memory and agent execution; the external client
executes its declared tools and returns results.

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

## Frontend library

[`@qingfeng346/remote-agent-client`](../../../../shared/remote-agent-client/README.md) implements
the client side of both transports, plus client-tool registration/execution and
a framework-agnostic single-round conversation model. Prefer it over hand-writing
a client; its `src/protocol.ts` mirrors this package's `src/protocol.ts` and must
be updated alongside it.
