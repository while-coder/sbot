# @qingfeng346/remote-agent-client

sbot `remote-agent` 通道的前端接入库。把「连上 sbot、收事件、执行本地工具、拼一轮对话」这几件事收成一个包，
框架无关、零运行时依赖，浏览器和 Node 都能跑。

分工照 `remote-agent` 通道的设计：**sbot 拥有会话、模型、历史与 agent 执行**，你的应用只负责声明自己此刻能做什么、
执行 sbot 派下来的工具调用、把文本结果回传。sbot 不需要知道你是调试器、IDE 还是别的什么。

本库包含：

- 入口对象 `RemoteAgentClient`：连接配置、用户身份、工具表配一次，按 `sessionId` 取会话。
- 协议类型与两种传输（HTTP + SSE、WebSocket），差异在传输层内部吸收，上层看到的事件流一致。
- 客户端工具注册与执行（`ToolRegistry`）。
- 一轮对话的界面状态模型（`AgentConversation`），含工具挂载、结果归位、流式、收尾。

不包含 UI 组件。渲染用什么框架都行，绑 `conversation.items` 即可。

## 安装

```bash
pnpm add @qingfeng346/remote-agent-client
```

Node 22 以下没有全局 `WebSocket`，用 WebSocket 传输时要通过 `webSocketFactory` 传入 `ws` 包（见下）。

## sbot 侧配置

需要 sbot 开一个 `remote-agent` 通道，详见 [channel.remote-agent 的 README](../../backend/plugins/channel/channel.remote-agent/README.md)。
每个通道实例只监听一种传输，两种都要就配两个实例：

```json
{
  "plugins": ["channel.remote-agent"],
  "channels": {
    "my-app-ws": {
      "type": "remote-agent",
      "config": { "transport": "websocket", "host": "0.0.0.0", "port": 5901, "accessToken": "换成一串足够长的随机串" }
    },
    "my-app-http": {
      "type": "remote-agent",
      "config": { "transport": "http", "host": "127.0.0.1", "port": 5902, "accessToken": "另换一串" }
    }
  }
}
```

客户端的 `url` 用哪种协议就走哪种传输：`http(s)://` → HTTP + SSE，`ws(s)://` → WebSocket。
也可以用 `transport: "http" | "websocket"` 显式指定。

## 最小接入

先建一个 `RemoteAgentClient`（整个应用一个就够），再按业务对象取会话：

```ts
import { RemoteAgentClient } from "@qingfeng346/remote-agent-client";

const client = new RemoteAgentClient({
  connection: { url: "http://127.0.0.1:5902", token: "配置里的 accessToken" },   // HTTP + SSE
  user: () => ({ userId: deviceId, userInfo: { name: "张三" } }),               // 设备级或账号级稳定 ID
  systemPrompt: () => "你在协助排查线上活动配置问题。",
});

const session = client.getSession(`${deviceId}:${orderId}`, { name: "订单 1024" });
session.subscribe(() => render(session));     // 这个会话的状态或消息有变化
await session.send("为什么这个活动没开");      // resolve 即本轮结束
```

WebSocket 只是换个 `url`（老 Node 再补一个工厂）：

```ts
import WebSocket from "ws";

const client = new RemoteAgentClient({
  connection: {
    url: "ws://127.0.0.1:5901",
    token: "配置里的 accessToken",
    webSocketFactory: url => new WebSocket(url) as never,  // Node 22+ 有全局 WebSocket，可省略
  },
  user,
});
```

`RemoteAgentClient` 的其他可选项：

| 选项 | 说明 |
| --- | --- |
| `tools` | 全部会话共用的客户端工具，见下节。可以给数组，也可以给一个自己维护的 `ToolRegistry`。 |
| `systemPrompt` | 每轮取一次的任务提示词，返回空字符串表示显式清空。 |
| `workPath` | sbot **那台机器上**的工作目录，只对本轮生效；返回空则用会话默认目录。 |
| `connection.fetch` / `connection.webSocketFactory` | 自定义 fetch / WebSocket 实现（走代理、加鉴权、测试替身）。 |

`systemPrompt` / `workPath` 都会带上是哪个会话（`session => ...`）。

监听只在会话上，因为事件本身是会话级的（每个会话独占一条连接），不必在全局回调里按会话过滤：

```ts
const offChange = session.subscribe(() => render(session));            // 状态或消息变化（含 running 切换）
const offEvents = session.subscribeEvents(event => log(event));        // 这个会话的原始协议事件
offChange(); offEvents();                                              // 取消订阅
```

会话是懒建的，`getSession()` 之后再订阅仍然赶在真正连上 sbot 之前，不会漏事件。

## 会话

一个 `sessionId` 对应 sbot 那边的一份历史，也对应本库的一份对话记录：

```ts
client.getSession(sessionId, sessionInfo?)   // 同一个 id 永远返回同一个实例；传了 sessionInfo 就顺便更新展示信息
client.sessions                              // 已创建的会话
client.has(sessionId)
client.closeSession(sessionId)               // 断开并丢弃对话记录，之后同名会拿到全新会话
client.dispose()                             // 关掉全部会话

session.sessionId
session.sessionInfo                                       // 只读，要改走 setSessionInfo
session.setSessionInfo({ name: "订单 1024（已关闭）" });   // 下一轮带上新信息，并通知订阅方重渲染
session.running
session.conversation
session.tools                                // 就是 client.tools，也可以只给这个会话加工具
session.subscribe(listener)                  // 状态或消息变化，返回取消订阅
session.subscribeEvents(listener)            // 原始协议事件，返回取消订阅
```

会话是懒建的：没发过消息就不会真的连上 sbot。每个会话独占一条连接（HTTP 是每轮一次请求，
WebSocket 是每会话一条 socket），所以多个会话可以同时跑，互不影响 —— 服务端事件不带 `sessionId`、
工具声明和任务提示词也是连接级的，共用一条连接会串台。

`session.send()` 也接受 scorpio.ai 的多模态 `content` 数组，以及 `{ attachments }`（`name` 搭配 `dataUrl` 或纯文本 `content`）。
只需要单个会话时也可以直接 `new AgentSession({ transport, sessionId, user, ... })`，`RemoteAgentClient` 只是帮你把这些参数复用起来。

## 客户端工具

工具就是「只有你的应用做得到的事」：读取运行时状态、调本地接口、看用户当前选中了什么。
声明会随每轮 `send()` 一起报给 sbot，`enabled()` 返回 false 的这轮就不报，模型也就不会去调。

```ts
client.tools.add({
  name: "get_selection",                    // 必须匹配 /^[A-Za-z][A-Za-z0-9_]*$/，否则 add 直接抛错
  description: "读取用户当前在界面上选中的对象",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  enabled: () => Boolean(currentSelection),
  async execute(args, { signal }) {
    return currentSelection;                // 非字符串会自动 JSON 序列化后回传
  },
});
```

- `execute` 抛错不会中断本轮：错误信息会作为 `isError` 结果回传，模型自己决定怎么处理。
- `signal` 在本轮结束或被中止时 abort，长任务应当据此尽快退出。
- sbot 侧的工具调用有 120 秒超时，长任务要么自己分段，要么先返回一个「已开始」。

## 渲染 conversation.items

`session.conversation.items` 是不可变快照（内容变了才换新数组），可以直接绑 Vue `ref` 或 React `useSyncExternalStore`
（用 `session.subscribe(listener)`，它比 `conversation.subscribe` 多覆盖 `running` 的切换）。字段含义：

| 字段 | 含义 |
| --- | --- |
| `role` | `"user"` 或 `"assistant"`。 |
| `content` | 正文。流式期间是本轮到目前为止的完整文本（**替换**语义，不要追加）。 |
| `streaming` | 这条还在流式输出中，收尾后自动置 false。 |
| `local` | 本地状态提示（请求失败、已停止），不属于对话内容，也不会回传给模型。 |
| `tools` | 挂在这条 AI 消息下的工具调用。sbot 自己那侧执行的工具和客户端工具在这里长得一样。 |
| `tools[].status` | `running` 执行中（sbot 会先推一条中间结果）、`done` 成功、`error` 失败或本轮结束时仍未返回。 |
| `tools[].result` | 结果文本，结束后才有。 |

停止与释放：

```ts
session.stop();                          // 先让 sbot 停掉本轮 agent，再本地收尾（未完成的工具标 error 并补一条「已停止」）
session.conversation.clear();             // 只清界面，sbot 那边的历史不受影响
client.closeSession(session.sessionId);   // 断开这个会话
client.dispose();                         // 退出时关掉全部会话
```

## 只要传输层

不需要本库的对话模型时，可以直接用传输：

```ts
import { createTransport, AgentServerMessageType } from "@qingfeng346/remote-agent-client";

const transport = createTransport({
  url: "ws://127.0.0.1:5901",
  token,
  onEvent: event => {
    if (event.type === AgentServerMessageType.ToolCall) {
      void transport.sendToolResult(event.toolCall.callId, "结果文本", false);
    }
  },
});
await transport.chat({ userId, userInfo: {}, sessionId, sessionInfo: {}, content: "你好", systemPrompt: "", tools: [] });
```

一个传输实例遵守「一次一轮」：`chat()` 在本轮收到 `done`（校验失败时是 `error`）后才 resolve，新一轮开始前会先收掉上一轮。
`ready` 和 `done` 由传输层自己消化，不会出现在 `onEvent` 里。要并发就一个会话一个传输实例，别共用。

## 本地验证

```bash
node examples/node.mjs --url ws://127.0.0.1:5901 --token <accessToken> --message "帮我看看活动配置"
node test/integration.mjs     # 起真实的 channel.remote-agent 服务端跑两种传输，不需要模型配置
```

## 协议同步

[src/protocol.ts](src/protocol.ts) 是 sbot 侧 [channel.remote-agent/src/protocol.ts](../../backend/plugins/channel/channel.remote-agent/src/protocol.ts)
的客户端视角副本（本库不引用那个包：它依赖 `channel.base` 与 node 类型，而这里要在浏览器里跑）。
**改协议时两边一起改。**
