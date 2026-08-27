import type { AgentTool } from "./tools";
import type { ChatMessage } from "./messages";
import { type LLMInfo, getLLMInfo } from "./capabilities";

export enum ModelProvider {
  OpenAI = "openai",
  OpenAIResponse = "openai-response",
  Anthropic = "anthropic",
  Ollama = "ollama",
  Gemini = "gemini",
  GeminiImage = "gemini-image",
}

export interface ModelConfig {
  provider: ModelProvider | string;
  apiKey: string;
  baseURL: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  contextWindow?: number;
  maxTools?: number;
  /**
   * 显式能力声明，优先级高于 models.dev 目录自动判断（vision / toolCall 等，
   * 只配需要覆盖的字段）。自定义网关配目录里没有的模型时用它声明。
   */
  llmInfo?: Partial<LLMInfo>;
  /** Provider 私有参数，由对应 provider 的 configSchema 定义。 */
  config?: Record<string, any>;
}

export interface ModelInvokeOptions {
  signal?: AbortSignal;
}

export interface StructuredInvokeOptions extends ModelInvokeOptions {
  strict?: boolean;
}

export interface IModelService {
  readonly config: ModelConfig;
  invoke(prompt: string | ChatMessage[], options?: ModelInvokeOptions): Promise<ChatMessage>;
  bindTools(tools: AgentTool[]): void;
  invokeStructured<T = any>(schema: any, prompt: string | ChatMessage[], options?: StructuredInvokeOptions): Promise<T>;
  stream(messages: string | ChatMessage[], options?: ModelInvokeOptions): Promise<AsyncIterable<ChatMessage>>;
  /**
   * 模型能力与限制（vision / toolCall / contextWindow / maxOutputTokens /
   * temperature / reasoning / structuredOutput / cost）。同步、无网络延迟，
   * llmInfo 显式声明优先于 models.dev 目录，结果进程内缓存。
   */
  getLLMInfo(): LLMInfo;
  dispose(): Promise<void>;
}

export const IModelService = Symbol("IModelService");

/**
 * 模型服务抽象基座：持有 config 与 LLM 能力目录缓存，
 * 具体的调用 / 工具绑定 / 流式 / 结构化输出由各 provider 用原生 SDK 实现。
 */
export abstract class ModelServiceBase implements IModelService {
  private llmInfoCache?: LLMInfo;

  constructor(public readonly config: ModelConfig) {}

  abstract initialize(): void;
  abstract invoke(prompt: string | ChatMessage[], options?: ModelInvokeOptions): Promise<ChatMessage>;
  abstract bindTools(tools: AgentTool[]): void;
  abstract invokeStructured<T = any>(schema: any, prompt: string | ChatMessage[], options?: StructuredInvokeOptions): Promise<T>;
  abstract stream(messages: string | ChatMessage[], options?: ModelInvokeOptions): Promise<AsyncIterable<ChatMessage>>;

  /** 子类 override 时调用 super.dispose() 以清掉目录信息缓存。 */
  async dispose(): Promise<void> {
    this.llmInfoCache = undefined;
  }

  getLLMInfo(): LLMInfo {
    const override = { ...this.config.llmInfo };
    if (this.config.contextWindow != null) override.contextWindow = this.config.contextWindow;
    if (this.config.maxTokens != null) override.maxOutputTokens = this.config.maxTokens;
    return (this.llmInfoCache ??= getLLMInfo(this.config.model, this.config.provider, override));
  }

  /** 解析结构化输出文本；错误信息含 "JSON" 以命中 shouldFallbackStructured，触发另一条结构化路径重试。 */
  protected parseStructuredOutput<T>(text: string): T {
    if (!text?.trim()) throw new Error("structured output was empty");
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw new Error(`Failed to parse structured output as JSON: ${(error as Error).message}`);
    }
  }

  /** 400/422 或报错内容命中结构化输出关键词时，切换另一条结构化路径重试。 */
  protected shouldFallbackStructured(options: StructuredInvokeOptions | undefined, error: unknown): boolean {
    if (options?.signal?.aborted) return false;
    const err = error as any;
    const status = err?.status ?? err?.response?.status ?? err?.cause?.status;
    if (status === 400 || status === 422) return true;
    // 各 SDK 的错误字段形状不同（err.error.message / err.response.data），全部提取后再匹配
    const message = [
      err?.message,
      err?.code,
      err?.type,
      err?.error?.message,
      err?.response?.data && JSON.stringify(err.response.data),
    ].filter(Boolean).join("\n");
    return /400|422|tool|function|structured|schema|response_format|tool_choice|parse|json/i.test(message);
  }

  /** 解析模型输出的工具入参：JSON 字符串（openai / anthropic）或 SDK 已解析对象（gemini），非对象一律收敛为 {}。 */
  protected tryParseToolArguments(args: unknown): Record<string, any> {
    let parsed: unknown = args;
    if (typeof args === "string") {
      try {
        parsed = JSON.parse(args || "{}");
      } catch {
        return {};
      }
    }
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, any>) : {};
  }
}
