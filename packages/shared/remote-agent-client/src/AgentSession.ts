import { AgentConversation } from "./AgentConversation.js";
import { createTransport } from "./createTransport.js";
import {
  AgentServerMessageType,
  type AgentChatRequest,
  type AgentServerEvent,
  type AgentSessionIdentity,
  type AgentSessionInfo,
  type AgentUserIdentity,
  type AttachmentInput,
  type MessageContent,
  type RemoteToolCall,
} from "./protocol.js";
import { ToolRegistry, type ClientTool } from "./ToolRegistry.js";
import type { RemoteAgentTransport, TransportOptions } from "./transport.js";

/** 直接给一个传输实例，或给连接配置由会话自己建（onEvent 由会话接管）。 */
export type AgentSessionTransport = RemoteAgentTransport | Omit<TransportOptions, "onEvent">;

export interface AgentSessionOptions {
  transport: AgentSessionTransport;
  /**
   * sbot 那边用哪份历史，同一个业务对象要一直用同一个值。
   * 建议拼上设备或账号前缀，避免多端撞车，如 `${deviceId}:${objectId}`。
   */
  sessionId: string;
  /** 会话的展示信息（名称、头像），sbot 用它显示这个会话是谁；之后可以用 setSessionInfo 改。 */
  sessionInfo?: AgentSessionInfo;
  /** 每轮取一次：谁在用，建议 userId 用设备级或账号级的稳定 ID。 */
  user: () => AgentUserIdentity;
  /** 客户端工具表，也可以直接给一组工具由会话自己建表。 */
  tools?: ToolRegistry | Array<ClientTool<any>>;
  /** 每轮取一次的任务提示词，返回空字符串表示显式清空。 */
  systemPrompt?: () => string;
  /** sbot 那台机器上的工作目录，只对本轮生效；返回空则不发，由 sbot 用会话默认目录。 */
  workPath?: () => string | undefined;
}

export interface SendOptions {
  attachments?: AttachmentInput[];
  /** 覆盖本轮的 workPath；省略则用 options.workPath()。 */
  workPath?: string;
}

/**
 * 一个 remote-agent 会话：管住「一次一轮」的状态、把 sbot 推来的消息落到 conversation、
 * 把客户端工具调用分发给 ToolRegistry 并回传结果。界面只需要读 conversation.items 和 running。
 *
 * 多个会话请用 RemoteAgentClient 创建：服务端事件不带 sessionId，一条连接同时只能承载一轮，
 * 每个会话得有自己的传输。
 */
export class AgentSession {
  readonly sessionId: string;
  readonly conversation = new AgentConversation();
  readonly tools: ToolRegistry;
  private readonly options: AgentSessionOptions;
  private readonly transport: RemoteAgentTransport;
  private readonly changeListeners = new Set<() => void>();
  private readonly eventListeners = new Set<(event: AgentServerEvent) => void>();
  private info: AgentSessionInfo;
  private active = false;
  private controller?: AbortController;

  constructor(options: AgentSessionOptions) {
    this.options = options;
    this.sessionId = options.sessionId;
    this.info = options.sessionInfo ?? {};
    this.tools = options.tools instanceof ToolRegistry ? options.tools : new ToolRegistry(options.tools ?? []);
    this.transport = isTransport(options.transport)
      ? options.transport
      : createTransport({ ...options.transport, onEvent: event => this.onEvent(event) });
    this.conversation.subscribe(() => this.notifyChange());
  }

  /** 本轮是否还在进行中。 */
  get running(): boolean {
    return this.active;
  }

  /** 会话的展示信息；要改用 setSessionInfo，别原地改这个对象，否则界面收不到通知。 */
  get sessionInfo(): AgentSessionInfo {
    return this.info;
  }

  /** 业务对象改名、换头像时调用：下一轮带上新的展示信息，并通知界面重渲染。 */
  setSessionInfo(sessionInfo: AgentSessionInfo): void {
    this.info = sessionInfo;
    this.notifyChange();
  }

  /**
   * 订阅本会话的状态或消息变化，返回取消订阅。
   * 比 conversation.subscribe() 多覆盖 running 的切换，界面绑这个就够。
   */
  subscribe(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => { this.changeListeners.delete(listener); };
  }

  /** 订阅本会话收到的原始协议事件（日志、进度提示之类），返回取消订阅。 */
  subscribeEvents(listener: (event: AgentServerEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => { this.eventListeners.delete(listener); };
  }

  /**
   * 发起一轮对话，resolve 即本轮结束（包括被中止）。连接层失败会写入一条本地提示而不是抛出，
   * 界面直接渲染 conversation 就够；需要自己处理时用 subscribeEvents()。
   */
  async send(input: string | MessageContent, options: SendOptions = {}): Promise<void> {
    if (this.active) throw new Error("上一轮分析还没结束");
    const content = normalizeContent(input);
    if (isEmpty(content)) return;
    this.conversation.addUser(typeof input === "string" ? input : textOf(content));
    this.active = true;
    this.controller = new AbortController();
    this.notifyChange();
    const workPath = (options.workPath ?? this.options.workPath?.() ?? "").trim();
    const request: AgentChatRequest = {
      ...this.identity(),
      content,
      systemPrompt: this.options.systemPrompt?.() ?? "",
      tools: this.tools.definitions(),
      ...(workPath && { workPath }),
      ...(options.attachments?.length && { attachments: options.attachments }),
    };
    try {
      // 一轮 chat 就是一次完整分析：transport 在收到 done / error 后才 resolve。
      await this.transport.chat(request);
    } catch (error) {
      this.conversation.addLocal(`请求失败：${message(error)}`);
    } finally {
      this.finishRound();
    }
  }

  /** 停止本轮：先让 sbot 停掉 agent，再本地收尾（未完成的工具会被标错）。 */
  stop(): void {
    if (!this.active) return;
    void this.transport.abort(this.identity());
    this.finishRound();
    this.conversation.addLocal("已停止本次分析。");
  }

  /** 断开连接并收掉本轮；会话对象之后不再可用。 */
  dispose(): void {
    if (this.active) this.stop();
    this.transport.close();
  }

  private identity(): AgentSessionIdentity {
    return { ...this.options.user(), sessionId: this.sessionId, sessionInfo: this.info };
  }

  private onEvent(event: AgentServerEvent): void {
    // 先派给订阅方，日志顺序才和事件到达顺序一致（工具会在处理时同步执行）。
    for (const listener of this.eventListeners) listener(event);
    if (event.type === AgentServerMessageType.Stream) {
      this.conversation.applyStream(event.content);
    } else if (event.type === AgentServerMessageType.Message) {
      this.conversation.applyMessage(event.message);
    } else if (event.type === AgentServerMessageType.ToolCall) {
      void this.executeTool(event.toolCall);
    } else if (event.type === AgentServerMessageType.Error) {
      this.conversation.addLocal(`请求失败：${event.message}`);
    }
  }

  private async executeTool(toolCall: RemoteToolCall): Promise<void> {
    const localEntry = this.conversation.beginClientTool(toolCall);
    const signal = this.controller?.signal ?? new AbortController().signal;
    const outcome = await this.tools.execute(toolCall, signal);
    this.conversation.completeClientTool(localEntry, outcome.output, outcome.isError);
    try {
      await this.transport.sendToolResult(toolCall.callId, outcome.output, outcome.isError);
    } catch (error) {
      // 结果没回传成功，sbot 那边要等到工具超时才继续，这里直接告诉用户。
      this.conversation.addLocal(`回传工具结果失败：${message(error)}`);
    }
  }

  private finishRound(): void {
    this.active = false;
    this.conversation.finishRound();
    // 本轮结束后还在跑的工具没有意义了，让它们的 signal 立刻 abort。
    this.controller?.abort();
    this.controller = undefined;
    this.notifyChange();
  }

  private notifyChange(): void {
    for (const listener of this.changeListeners) listener();
  }
}

function isTransport(value: AgentSessionTransport): value is RemoteAgentTransport {
  return typeof (value as RemoteAgentTransport).chat === "function";
}

function normalizeContent(input: string | MessageContent): MessageContent {
  return typeof input === "string" ? [{ type: "text", text: input }] : input;
}

function isEmpty(content: MessageContent): boolean {
  return typeof content === "string" ? !content.trim() : content.length === 0;
}

/** 多模态输入在界面上按文本段展示，和 sbot 取纯文本的做法一致。 */
function textOf(content: MessageContent): string {
  if (typeof content === "string") return content;
  return content
    .filter(part => part.type === "text")
    .map(part => typeof part.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n");
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
