import type { RemoteToolCall, RemoteToolDefinition } from "./protocol.js";

/** 与服务端 RemoteAgentConnection 的过滤规则一致，不合规的工具名会被 sbot 直接丢掉。 */
const TOOL_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

export interface ToolExecuteContext {
  /** 本次调用的 callId，回传结果时由会话自动带上，这里只用于日志或去重。 */
  callId: string;
  /** 本轮结束或被中止时触发；长任务应当在它 abort 后尽快退出。 */
  signal: AbortSignal;
}

export interface ClientTool<A = Record<string, unknown>> {
  name: string;
  /** 给模型看的说明，写清副作用与调用前置条件。 */
  description?: string;
  /** JSON Schema，直接透传给 sbot。 */
  inputSchema: Record<string, unknown>;
  /** 按运行时条件决定本轮是否声明这个工具（例如目录还没授权就不上报）。 */
  enabled?: () => boolean;
  /** 返回值不是字符串时会被 JSON 序列化后回传；抛错则按工具失败回传给模型。 */
  execute: (args: A, context: ToolExecuteContext) => unknown | Promise<unknown>;
}

export interface ToolOutcome {
  output: string;
  isError: boolean;
}

/**
 * 客户端工具表：负责每轮的工具声明，以及把 sbot 的 toolCall 分发到对应实现。
 * 需要用户确认的工具（改状态、发命令）自己在 execute 里弹确认，库不代做这件事。
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ClientTool<any>>();

  constructor(tools: Array<ClientTool<any>> = []) {
    this.add(...tools);
  }

  add(...tools: Array<ClientTool<any>>): this {
    for (const tool of tools) {
      if (!TOOL_NAME.test(tool.name)) {
        throw new Error(`工具名 ${tool.name} 不合规：只能用字母开头的字母、数字和下划线`);
      }
      this.tools.set(tool.name, tool);
    }
    return this;
  }

  remove(name: string): boolean {
    return this.tools.delete(name);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  clear(): void {
    this.tools.clear();
  }

  /** 本轮要声明给 sbot 的工具；空数组是合法值，表示这一轮没有客户端工具。 */
  definitions(): RemoteToolDefinition[] {
    const definitions: RemoteToolDefinition[] = [];
    for (const tool of this.tools.values()) {
      if (tool.enabled && !tool.enabled()) continue;
      definitions.push({
        name: tool.name,
        ...(tool.description?.trim() && { description: tool.description.trim() }),
        inputSchema: tool.inputSchema,
      });
    }
    return definitions;
  }

  /** 执行一次工具调用，结果统一成可回传的文本；失败也不抛，交给模型自己纠错。 */
  async execute(call: RemoteToolCall, signal: AbortSignal): Promise<ToolOutcome> {
    const tool = this.tools.get(call.name);
    if (!tool) return { output: `未注册工具：${call.name}`, isError: true };
    try {
      const result = await tool.execute(call.args, { callId: call.callId, signal });
      return { output: typeof result === "string" ? result : stringify(result), isError: false };
    } catch (error) {
      return { output: error instanceof Error ? error.message : String(error), isError: true };
    }
  }
}

function stringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? null) ?? "null";
  } catch {
    return String(value);
  }
}
