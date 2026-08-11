import { MessageRole, MessageStatus, type RemoteChatMessage, type RemoteMessageToolCall, type RemoteToolCall } from "./protocol.js";

export type ConversationRole = "user" | "assistant";

export type ToolEntryStatus = "running" | "done" | "error";

/** 一次工具调用；result 在结束后才有，status 决定摘要行显示「执行中」还是结果预览。 */
export interface ToolEntry {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: ToolEntryStatus;
  result?: string;
}

/**
 * 一条消息。工具调用挂在发起它的那条 AI 消息下（和 sbot 自己的界面一致），不单独占一行。
 * local 表示这条是本地插的状态提示（请求失败、已停止），不属于对话内容，也不会回传给模型。
 */
export interface ConversationItem {
  id: number;
  role: ConversationRole;
  content: string;
  createdAt: Date;
  local?: boolean;
  streaming?: boolean;
  tools?: ToolEntry[];
}

const RUNNING_ENDED = "本轮已结束，没有收到结果";

/**
 * 一轮对话在界面上的形状，框架无关：内部可变，对外只给不可变快照 + 变更订阅。
 * Vue 用 ref + subscribe，React 用 useSyncExternalStore，都不需要本库依赖任何响应式实现。
 *
 * sbot 会把整轮对话都推过来（带 tool_calls 的 AI 消息、工具结果、纯文本回复），
 * 它自己那侧执行的工具和客户端工具在这里没有区别，客户端工具只是多了一次前端执行的往返。
 */
export class AgentConversation {
  private readonly all: ConversationItem[] = [];
  private readonly listeners = new Set<() => void>();
  private snapshot?: readonly ConversationItem[];
  private streamItem?: ConversationItem;
  private sequence = 0;

  /** 不可变快照，内容变化后才会换新数组，可直接用于渲染或 diff。 */
  get items(): readonly ConversationItem[] {
    return this.snapshot ??= this.all.map(item => ({ ...item, ...(item.tools && { tools: item.tools.map(tool => ({ ...tool })) }) }));
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  clear(): void {
    this.all.length = 0;
    this.streamItem = undefined;
    this.changed();
  }

  addUser(content: string): void {
    this.add("user", content);
    this.changed();
  }

  /** 本地状态提示：请求失败、已停止这类只给用户看的内容。 */
  addLocal(content: string): void {
    this.add("assistant", content, true);
    this.changed();
  }

  /** 流式续写。sbot 推来的是本轮到目前为止的完整文本，按替换处理。 */
  applyStream(content: string): void {
    const item = this.streamItem ??= this.add("assistant", "");
    item.streaming = true;
    item.content = content;
    this.changed();
  }

  applyMessage(message: RemoteChatMessage): void {
    if (message.role === MessageRole.Tool) return this.applyToolResult(message);
    if (message.role !== MessageRole.AI) return;
    // 既没正文也没工具调用（比如只带 usage 的空消息）就没什么可显示的，别插一个空气泡。
    if (!this.streamItem && !message.content && message.toolCalls.length === 0) return;
    const item = this.streamItem ?? this.add("assistant", "");
    // 只调工具不说话时正文是空的，别把流式已经收到的那段文本清掉。
    if (message.content) item.content = message.content;
    item.streaming = false;
    this.streamItem = undefined;
    for (const call of message.toolCalls) this.addTool(call, item);
    this.changed();
  }

  /**
   * 客户端工具开始执行。调用条目正常由消息流生成，结果也由随后那条 tool 消息填上；
   * 只有 sbot 那边没有推完整消息流时才本地补一条，返回它的 id 以便自己填结果，
   * 保证用户至少看得到这次工具执行。
   */
  beginClientTool(toolCall: RemoteToolCall): string | undefined {
    if (this.findRunningTool(toolCall.name)) return undefined;
    const entry = this.addTool({ id: `local-${++this.sequence}`, name: toolCall.name, args: toolCall.args });
    this.changed();
    return entry.id;
  }

  /** 给 beginClientTool 补出来的本地条目填结果。 */
  completeClientTool(entryId: string | undefined, result: string, isError: boolean): void {
    if (!entryId) return;
    const entry = this.allTools().find(tool => tool.id === entryId);
    // 已经落定的条目不再改：本轮被 finishRound 收掉后，工具因 signal abort 才返回的结果
    // 不该把界面上的「本轮已结束」翻回成功。
    if (!entry || entry.status !== "running") return;
    entry.result = result;
    entry.status = isError ? "error" : "done";
    this.changed();
  }

  /** 本轮收尾：流式气泡停止闪烁，仍在执行的工具永远等不到结果了，标错。 */
  finishRound(): void {
    if (this.streamItem) this.streamItem.streaming = false;
    this.streamItem = undefined;
    for (const tool of this.allTools()) {
      if (tool.status !== "running") continue;
      tool.status = "error";
      tool.result ??= RUNNING_ENDED;
    }
    this.changed();
  }

  private applyToolResult(message: RemoteChatMessage): void {
    const target = this.findTool(message.toolCallId, message.name)
      // 只收到结果没收到调用（消息乱序或被丢过）时补一条，免得这一步在界面上凭空消失。
      ?? this.addTool({ id: message.toolCallId, name: message.name, args: {} });
    target.result = message.content;
    // sbot 会先推一条 running 的中间结果，最终那条才带成功 / 失败。
    target.status = message.status === MessageStatus.Running
      ? "running"
      : message.status === MessageStatus.Error ? "error" : "done";
    this.changed();
  }

  /** 内部构造不通知，由公开方法在一次改动做完后统一通知，避免订阅方看到半成品状态。 */
  private add(role: ConversationRole, content: string, local = false): ConversationItem {
    const item: ConversationItem = { id: ++this.sequence, role, content, createdAt: new Date(), ...(local && { local }) };
    this.all.push(item);
    return item;
  }

  /** 工具调用挂在最后那条 AI 消息下；没有可挂的就补一条空正文的 AI 消息（不出气泡，只显示工具块）。 */
  private toolHost(): ConversationItem {
    const last = this.all[this.all.length - 1];
    if (last && last.role === "assistant" && !last.local) return last;
    return this.add("assistant", "");
  }

  private addTool(call: RemoteMessageToolCall, host: ConversationItem = this.toolHost()): ToolEntry {
    const tools = host.tools ??= [];
    const entry: ToolEntry = {
      id: call.id || `tool-${++this.sequence}`,
      name: call.name || "工具",
      args: call.args ?? {},
      status: "running",
    };
    tools.push(entry);
    return entry;
  }

  /** 全部工具条目，按出现顺序展开；结果归位和「有没有正在跑的同名调用」都要在全局范围里找。 */
  private allTools(): ToolEntry[] {
    return this.all.flatMap(item => item.tools ?? []);
  }

  /** 结果按 toolCallId 对上发起它的调用；没有 id 时退回最后一个同名且还在执行的条目。 */
  private findTool(callId: string, name: string): ToolEntry | undefined {
    const tools = this.allTools();
    const exact = callId ? tools.find(tool => tool.id === callId) : undefined;
    return exact ?? this.findRunningTool(name, tools);
  }

  private findRunningTool(name: string, tools = this.allTools()): ToolEntry | undefined {
    for (let index = tools.length - 1; index >= 0; index--) {
      const tool = tools[index];
      if (tool && tool.name === name && tool.status === "running") return tool;
    }
    return undefined;
  }

  private changed(): void {
    this.snapshot = undefined;
    for (const listener of this.listeners) listener();
  }
}
