/**
 * 对着真实 sbot 跑一轮的最小示例（零依赖，Node 22+）。
 *
 *   node examples/node.mjs --url http://127.0.0.1:5902 --token <accessToken>
 *   node examples/node.mjs --url ws://127.0.0.1:5901  --token <accessToken> --message "帮我看看活动配置"
 *
 * 传输按 url 协议自动选，也可以用 --transport ws|http 强制指定。
 * 注册了一个 echo 工具：让模型调它，就能看到 toolCall → 本地执行 → 回传结果的完整往返。
 */
import { AgentServerMessageType, RemoteAgentClient } from "../esm/index.js";

const args = parseArgs(process.argv.slice(2));
if (!args.url || !args.token) {
  console.error("用法：node examples/node.mjs --url <http(s)|ws(s) 地址> --token <accessToken> [--message 文本] [--session-id 会话 ID] [--transport ws|http] [--work-path 目录]");
  process.exit(1);
}

const client = new RemoteAgentClient({
  connection: {
    url: args.url,
    token: args.token,
    ...(args.transport && { transport: args.transport === "ws" ? "websocket" : args.transport }),
  },
  tools: [{
    name: "echo",
    description: "回显调用参数，用来验证客户端工具通道是否打通",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "要回显的文本" } },
      required: ["text"],
      additionalProperties: false,
    },
    execute(input) {
      console.log(`  [tool] echo ${JSON.stringify(input)}`);
      return { echoed: input.text };
    },
  }],
  user: () => ({ userId: "example-device", userInfo: { name: "示例用户" } }),
  systemPrompt: () => "你在协助验证 remote-agent 客户端接入，可以调用 echo 工具。",
  ...(args["work-path"] && { workPath: () => args["work-path"] }),
});

// 一个业务对象一个 sessionId，sbot 那边按它区分历史；这里给个固定值方便反复试。
const session = client.getSession(args["session-id"] || "example-device:demo", { name: "示例会话" });

// 事件监听是会话级的：订阅在 send() 之前登记就不会漏事件（会话是懒建的，此刻还没连上 sbot）。
session.subscribeEvents(event => {
  if (event.type === AgentServerMessageType.Stream) process.stdout.write("\r" + oneLine(event.content));
  else if (event.type === AgentServerMessageType.Message) console.log(`\n  [message] ${describe(event.message)}`);
  else if (event.type === AgentServerMessageType.ToolCall) console.log(`\n  [toolCall] ${event.toolCall.name} ${JSON.stringify(event.toolCall.args)}`);
  else if (event.type === AgentServerMessageType.Error) console.log(`\n  [error] ${event.message}`);
});

const message = args.message || "调用 echo 工具回显「接通了」，然后告诉我结果。";
console.log(`> ${message}\n`);

// Ctrl+C 走中止路径：sbot 侧停掉本轮 agent，本地未完成的工具会被标错。
process.on("SIGINT", () => {
  console.log("\n中止本轮…");
  session.stop();
});

await session.send(message);
console.log("\n--- 本轮对话 ---");
for (const item of session.conversation.items) {
  const prefix = item.role === "user" ? "用户" : item.local ? "本地" : "AI";
  if (item.content) console.log(`${prefix}: ${item.content}`);
  for (const tool of item.tools ?? []) console.log(`  · ${tool.name} [${tool.status}] ${oneLine(tool.result ?? "")}`);
}
client.dispose();

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index++) {
    const key = argv[index];
    if (!key.startsWith("--")) continue;
    const next = argv[index + 1];
    result[key.slice(2)] = next && !next.startsWith("--") ? (index++, next) : "true";
  }
  return result;
}

/** stream 推的是本轮到目前为止的完整文本，这里只取末尾一段刷在同一行上。 */
function oneLine(text) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 100 ? `…${flat.slice(-100)}` : flat;
}

function describe(chatMessage) {
  const calls = chatMessage.toolCalls.map(call => call.name).join(", ");
  const parts = [chatMessage.role];
  if (chatMessage.name) parts.push(chatMessage.name);
  if (chatMessage.status) parts.push(chatMessage.status);
  if (calls) parts.push(`→ ${calls}`);
  return `${parts.join(" ")} ${oneLine(chatMessage.content)}`;
}
