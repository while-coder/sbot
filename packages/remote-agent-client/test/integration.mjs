/**
 * 端到端验证：跑真实的 channel.remote-agent 服务端（HTTP 与 WebSocket 两种传输），
 * 只把「会话交给模型」那一步替换成脚本自己按协议推事件，因此不需要模型配置也不花 token。
 *
 * 用法：node --experimental-strip-types 无关，直接 node test/integration.mjs
 * 依赖 packages/channel.remote-agent/dist 已构建；没构建就跳过（不视为失败）。
 */
import { createRequire } from "node:module";
import { MessageRole, MessageStatus, RemoteAgentClient } from "../esm/index.js";

const require = createRequire(import.meta.url);
const TOKEN = "integration-token";
/** 每个用例用一对新端口：服务端 dispose 后端口不会立刻释放，复用会撞上还没退干净的上一个 server。 */
let nextPort = 45910;
function takePort() {
  return nextPort += 2;
}

let server;
try {
  server = require("../../channel.remote-agent/dist/index.js");
} catch (error) {
  console.log(`跳过：channel.remote-agent 未构建（${error.message}）`);
  process.exit(0);
}

const user = () => ({ userId: "device-1", userInfo: { name: "集成测试" } });
const SESSION_ID = "device-1:object-1";

let failures = 0;
function check(ok, label) {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${label}`);
  if (!ok) failures++;
}

/** 模拟 sbot 的一轮回复：流式两段 → 带工具调用的 ai 消息 → 调客户端工具 → 工具结果 → 收尾文本 → done。 */
async function respondWithToolCall(connection) {
  connection.emit("stream", { content: "在查" });
  connection.emit("stream", { content: "在查活动配置" });
  connection.emit("message", {
    message: {
      role: MessageRole.AI,
      content: "我先看一下客户端状态。",
      tool_calls: [{ id: "call-1", name: "echo", args: { text: "hello" } }],
    },
  });
  const outcome = await connection.callTool("echo", { text: "hello" });
  connection.emit("message", {
    message: {
      role: MessageRole.Tool,
      content: outcome.output,
      tool_call_id: "call-1",
      name: "echo",
      status: outcome.isError ? MessageStatus.Error : MessageStatus.Success,
    },
  });
  connection.emit("message", { message: { role: MessageRole.AI, content: "活动没开是因为时间没到。" } });
  connection.emit("done");
  return outcome;
}

function createService(kind, port, onReceiveMessage, onTriggerAction) {
  const options = { accessToken: TOKEN, onReceiveMessage, onTriggerAction, port, host: "127.0.0.1" };
  return kind === "ws" ? new server.RemoteWSAgentService(options) : new server.RemoteHttpAgentService(options);
}

function url(kind, port) {
  return kind === "ws" ? `ws://127.0.0.1:${port}` : `http://127.0.0.1:${port}`;
}

function newClient(kind, port, extra = {}) {
  return new RemoteAgentClient({
    connection: { url: url(kind, port), token: TOKEN },
    tools: [{
      name: "echo",
      description: "回显参数",
      inputSchema: { type: "object", properties: { text: { type: "string" } } },
      execute: args => ({ echoed: args.text }),
    }],
    user,
    ...extra,
  });
}

/** 正常一轮：消息、流式、工具往返、收尾。 */
async function testRound(kind) {
  console.log(`\n[${kind}] 完整一轮`);
  let seenTools;
  let seenWorkPath;
  let outcome;
  const port = takePort();
  const service = createService(kind, port, async (userId, userInfo, sessionInfo, args) => {
    seenTools = args.connection.getTools();
    seenWorkPath = args.workPath;
    check(userId === "device-1" && sessionInfo.name === "对象 1", "服务端收到身份信息");
    outcome = await respondWithToolCall(args.connection);
  }, async () => {});
  await service.start();
  const client = newClient(kind, port, { workPath: () => "e:/sbox" });
  const session = client.getSession(SESSION_ID, { name: "对象 1" });
  let changes = 0;
  const seenEvents = [];
  const offChange = session.subscribe(() => changes++);
  const offEvents = session.subscribeEvents(event => seenEvents.push(event.type));
  try {
    check(client.getSession(SESSION_ID) === session, "同一个 sessionId 返回同一个会话");
    await session.send("为什么活动没开");
    const items = session.conversation.items;
    check(seenTools?.length === 1 && seenTools[0].name === "echo", "客户端工具声明已上报");
    check(seenWorkPath === "e:/sbox", "workPath 透传到服务端");
    check(outcome?.isError === false && outcome.output.includes("hello"), "工具结果回传到服务端");
    check(items[0]?.role === "user" && items[0].content === "为什么活动没开", "用户消息落库");
    const withTool = items.find(item => item.tools?.length);
    check(withTool?.content === "我先看一下客户端状态。", "工具挂在发起它的 AI 消息下");
    check(withTool?.tools?.[0]?.status === "done", "工具结果按 tool_call_id 归位并标成功");
    check(items[items.length - 1]?.content === "活动没开是因为时间没到。", "收尾文本是最后一条");
    check(items.every(item => !item.streaming), "本轮结束后没有残留的流式气泡");
    check(session.running === false, "running 已复位");
    check(changes > 0 && seenEvents.includes("stream") && seenEvents.includes("toolCall"), "会话级订阅收到变更与原始事件");
    offChange();
    offEvents();
    const settled = changes;
    session.setSessionInfo({ name: "对象 1（改名）" });
    check(changes === settled, "取消订阅后不再收到通知");
  } finally {
    client.dispose();
    service.dispose();
  }
}

/** 中止路径：收到第一个 stream 就 stop()，服务端应收到 abort，未完成的工具标错。 */
async function testAbort(kind) {
  console.log(`\n[${kind}] 中止`);
  let aborted;
  let toolSignalAborted = false;
  const port = takePort();
  const service = createService(kind, port, async (userId, userInfo, sessionInfo, args) => {
    args.connection.emit("stream", { content: "开始分析" });
    // 客户端会在这次调用悬着的时候 stop()，服务端这边就当 agent 一直没等到结果。
    args.connection.callTool("echo", { text: "slow" }).catch(() => {});
  }, async (userId, userInfo, sessionInfo, args) => {
    aborted = args;
  });
  await service.start();
  const client = newClient(kind, port, {
    tools: [{
      name: "echo",
      inputSchema: { type: "object" },
      // 永远不返回，直到本轮 signal abort。
      execute: (args, context) => new Promise(resolve => {
        context.signal.addEventListener("abort", () => { toolSignalAborted = true; resolve("aborted"); });
      }),
    }],
  });
  const session = client.getSession(SESSION_ID, { name: "对象 1" });
  session.subscribeEvents(event => { if (event.type === "stream") setTimeout(() => session.stop(), 20); });
  try {
    await session.send("跑个长的");
    // stop() 之后 HTTP 传输要等响应流真正关掉，abort 回调可能稍晚一点到。
    await new Promise(resolve => setTimeout(resolve, 150));
    check(aborted?.action === "abort" && aborted.sessionId === SESSION_ID, "服务端收到 abort");
    check(toolSignalAborted, "工具的 signal 被 abort");
    const items = session.conversation.items;
    check(items[items.length - 1]?.local === true, "界面上补了本地「已停止」提示");
    const tool = items.flatMap(item => item.tools ?? []).find(entry => entry.name === "echo");
    check(tool?.status === "error", "未完成的工具被标错");
    check(session.running === false, "running 已复位");
  } finally {
    client.dispose();
    service.dispose();
  }
}

/** 多个会话各自独立：同时发消息也不会串台，对话记录各自留存。 */
async function testSessions(kind) {
  console.log(`\n[${kind}] 多会话并发`);
  const seen = [];
  const port = takePort();
  const service = createService(kind, port, async (userId, userInfo, sessionInfo, args) => {
    seen.push(args.sessionId);
    // 故意错开收尾顺序，两条连接串台的话消息就会落到对方的对话里。
    const delay = args.sessionId.endsWith("a") ? 60 : 10;
    await new Promise(resolve => setTimeout(resolve, delay));
    args.connection.emit("message", { message: { role: MessageRole.AI, content: `回复 ${args.sessionId}` } });
    args.connection.emit("done");
  }, async () => {});
  await service.start();
  const client = newClient(kind, port);
  const first = client.getSession("device-1:a", { name: "对象 A" });
  const second = client.getSession("device-1:b", { name: "对象 B" });
  try {
    await Promise.all([first.send("问 A"), second.send("问 B")]);
    check(seen.length === 2 && seen.includes("device-1:a") && seen.includes("device-1:b"), "两个会话都到了服务端");
    check(last(first)?.content === "回复 device-1:a", "会话 A 只收到自己的回复");
    check(last(second)?.content === "回复 device-1:b", "会话 B 只收到自己的回复");
    check(first.conversation.items.length === 2 && second.conversation.items.length === 2, "两份对话记录互不掺杂");
    check(client.sessions.length === 2, "client.sessions 列出全部会话");
    client.closeSession("device-1:a");
    check(!client.has("device-1:a") && client.getSession("device-1:a").conversation.items.length === 0, "关掉的会话重开是全新的");
  } finally {
    client.dispose();
    service.dispose();
  }
}

/** 令牌不对时两种传输都要给出可读错误，而不是卡住。 */
async function testBadToken(kind) {
  console.log(`\n[${kind}] 错误令牌`);
  const port = takePort();
  const service = createService(kind, port, async () => {}, async () => {});
  await service.start();
  const client = new RemoteAgentClient({ connection: { url: url(kind, port), token: "wrong" }, user });
  const session = client.getSession(SESSION_ID);
  try {
    await session.send("你好");
    check(last(session)?.local === true && last(session).content.startsWith("请求失败："), `失败提示可读：${last(session)?.content}`);
  } finally {
    client.dispose();
    service.dispose();
  }
}

function last(session) {
  const items = session.conversation.items;
  return items[items.length - 1];
}

for (const kind of ["http", "ws"]) {
  await testRound(kind);
  await testAbort(kind);
  await testSessions(kind);
  await testBadToken(kind);
}

console.log(failures === 0 ? "\n全部通过" : `\n${failures} 项失败`);
process.exit(failures === 0 ? 0 : 1);
