import {
  AgentServerMessageType,
  asObject,
  asString,
  parseChatMessage,
  parseJson,
  type AgentChatRequest,
  type AgentSessionIdentity,
} from "./protocol.js";
import { asError, type FetchLike, type RemoteAgentTransport, type TransportOptions } from "./transport.js";
import { normalizeBaseUrl } from "./utils.js";

/** SSE 事件块之间的空行；服务端用 \n，经代理后可能变成 \r\n。 */
const EVENT_DELIMITER = /\r?\n\r?\n/;

interface AgentRun {
  /** POST /chat 的首个 ready 事件才带 requestId，工具结果和中止都要用它定位本轮。 */
  requestId: string;
  controller: AbortController;
  /** chat() 走完 finally 才 resolve，供中止方等待响应流真正收尾。 */
  settled: Promise<void>;
  sawEnd: boolean;
}

/**
 * HTTP 传输：POST /chat 保持一条 SSE 响应直到本轮结束，工具结果和中止各走一次独立的 POST。
 */
export class HttpAgentTransport implements RemoteAgentTransport {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly onEvent: TransportOptions["onEvent"];
  private readonly fetchImpl: FetchLike;
  private run?: AgentRun;

  constructor(options: TransportOptions) {
    this.baseUrl = normalizeBaseUrl(options.url);
    this.token = options.token;
    this.onEvent = options.onEvent;
    this.fetchImpl = options.fetch ?? defaultFetch();
  }

  async chat(request: AgentChatRequest): Promise<void> {
    await this.stopRun();
    let finish = (): void => {};
    const run: AgentRun = {
      requestId: "",
      controller: new AbortController(),
      settled: new Promise<void>(resolve => { finish = resolve; }),
      sawEnd: false,
    };
    this.run = run;
    try {
      const response = await this.post("chat", request, run.controller.signal, "text/event-stream");
      await this.readEvents(response, run);
      // 服务端每轮都以 done 收尾（校验失败时是 error），流提前断掉说明连接被中途掐断。
      if (!run.sawEnd && !run.controller.signal.aborted) throw new Error("sbot 响应流意外结束");
    } catch (error) {
      if (!run.controller.signal.aborted) throw asError(error);
    } finally {
      if (this.run === run) this.run = undefined;
      finish();
    }
  }

  async sendToolResult(callId: string, output: string, isError: boolean): Promise<void> {
    const run = this.run;
    if (!run?.requestId) return;
    await this.post("tool-result", { requestId: run.requestId, callId, output, isError }, run.controller.signal);
  }

  /** 先让 sbot 停掉本轮 agent，再关本地响应流；顺序反了服务端会因连接已关而找不到本轮。 */
  async abort(identity: AgentSessionIdentity): Promise<void> {
    const run = this.run;
    if (!run) return;
    try {
      if (run.requestId) await this.post("abort", { requestId: run.requestId, ...identity }, run.controller.signal);
    } catch {
      // 中止本身失败不影响界面收尾，本轮仍会因连接关闭而在服务端结束。
    }
    await this.stopRun();
  }

  close(): void {
    void this.stopRun();
  }

  private async stopRun(): Promise<void> {
    const run = this.run;
    if (!run) return;
    run.controller.abort();
    await run.settled;
  }

  private async post(path: string, body: unknown, signal: AbortSignal, accept?: string): Promise<Response> {
    const response = await this.fetchImpl(`${this.baseUrl}/${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.token}`,
        ...(accept && { accept }),
      },
      body: JSON.stringify(body),
      signal,
    });
    if (!response.ok) throw new Error(describeStatus(response.status));
    return response;
  }

  private async readEvents(response: Response, run: AgentRun): Promise<void> {
    if (!response.body) throw new Error("当前环境不支持流式响应，无法接收 sbot 的 SSE");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      // 末段可能只收到一半，留在缓冲里等后续分片。
      const blocks = buffer.split(EVENT_DELIMITER);
      buffer = blocks.pop() ?? "";
      for (const block of blocks) this.dispatch(block, run);
    }
  }

  private dispatch(block: string, run: AgentRun): void {
    const event = parseEvent(block);
    if (!event) return;
    if (event.type === AgentServerMessageType.Ready) {
      run.requestId = asString(event.data.requestId);
    } else if (event.type === AgentServerMessageType.Stream) {
      this.onEvent({ type: AgentServerMessageType.Stream, content: asString(event.data.content) });
    } else if (event.type === AgentServerMessageType.Message) {
      this.onEvent({ type: AgentServerMessageType.Message, message: parseChatMessage(event.data.message) });
    } else if (event.type === AgentServerMessageType.ToolCall) {
      this.onEvent({
        type: AgentServerMessageType.ToolCall,
        toolCall: {
          callId: asString(event.data.callId),
          name: asString(event.data.name),
          args: asObject(event.data.args),
        },
      });
    } else if (event.type === AgentServerMessageType.Error) {
      run.sawEnd = true;
      this.onEvent({ type: AgentServerMessageType.Error, message: asString(event.data.message) || "sbot 请求失败" });
    } else if (event.type === AgentServerMessageType.Done) {
      run.sawEnd = true;
    }
  }
}

function parseEvent(block: string): { type: string; data: Record<string, unknown> } | undefined {
  let type = "";
  const dataLines: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) type = line.slice("event:".length).trim();
    else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trimStart());
  }
  if (!type) return undefined;
  return { type, data: dataLines.length > 0 ? asObject(parseJson(dataLines.join("\n"))) : {} };
}

function describeStatus(status: number): string {
  if (status === 401) return "sbot 拒绝了访问令牌（401）";
  if (status === 404) return "sbot 找不到该接口或本轮已结束（404）";
  return `sbot 返回 HTTP ${status}`;
}

function defaultFetch(): FetchLike {
  if (typeof fetch !== "function") throw new Error("当前环境没有全局 fetch，请通过 fetch 选项传入实现");
  // 绑定到全局：某些环境（jsdom、部分 polyfill）里脱离 this 调用会抛 Illegal invocation。
  return (input, init) => fetch(input, init);
}
