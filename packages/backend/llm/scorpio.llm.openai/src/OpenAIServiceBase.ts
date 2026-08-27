import OpenAI from "openai";
import type { CompletionUsage } from "openai/resources/completions";
import {
  type LLMInfo,
  type ModelConfig,
  type ModelInvokeOptions,
  type StructuredInvokeOptions,
  type TokenUsage,
  getLLMInfo,
} from "scorpio.llm";

/**
 * 部分 OpenAI 兼容网关直接返回错误对象，而不是官方的 `{ error: ... }`。
 * 统一成官方 SDK 能解析的形状；成功响应完全透传。
 */
export async function compatibleOpenAIFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const response = await globalThis.fetch(input, init);
  if (response.ok) return response;

  let raw = "";
  try {
    raw = await response.clone().text();
  } catch {
    return response;
  }
  if (!raw.trim()) return response;

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return response;
  }
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.error != null) return response;

  const error = parsed && typeof parsed === "object"
    ? parsed
    : { message: typeof parsed === "string" ? parsed : raw };
  const headers = new Headers(response.headers);
  headers.set("content-type", "application/json");
  headers.delete("content-length");
  headers.delete("content-encoding");
  return new Response(JSON.stringify({ error }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** OpenAI 客户端与结构化输出解析的公共基座，供 Chat Completions / Responses 两个实现共用。 */
export abstract class OpenAIServiceBase {
  protected client?: OpenAI;
  private llmInfoCache?: LLMInfo;

  constructor(public readonly config: ModelConfig) {}

  initialize(): void {
    if (!this.config.apiKey) throw new Error("OpenAI config missing apiKey");
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      fetch: compatibleOpenAIFetch,
    });
    this.getLLMInfo();
  }

  async dispose(): Promise<void> {
    this.client = undefined;
    this.llmInfoCache = undefined;
  }

  getLLMInfo(): LLMInfo {
    const override = { ...this.config.llmInfo };
    if (this.config.contextWindow != null) override.contextWindow = this.config.contextWindow;
    if (this.config.maxTokens != null) override.maxOutputTokens = this.config.maxTokens;
    return (this.llmInfoCache ??= getLLMInfo(this.config.model, this.config.provider, override));
  }

  protected assertInitialized(): void {
    if (!this.client) throw new Error(`${this.constructor.name} is not initialized`);
  }

  protected requestOptions(options?: ModelInvokeOptions): { signal: AbortSignal } | undefined {
    return options?.signal ? { signal: options.signal } : undefined;
  }

  protected toUsage(usage: CompletionUsage): TokenUsage {
    return {
      input_tokens: usage.prompt_tokens ?? 0,
      output_tokens: usage.completion_tokens ?? 0,
      total_tokens: usage.total_tokens ?? 0,
      ...(usage.prompt_tokens_details?.cached_tokens != null && {
        cache_read_input_tokens: usage.prompt_tokens_details.cached_tokens,
      }),
    };
  }

  protected tryParseToolArguments(argumentsJson: string): Record<string, any> {
    try {
      const parsed = JSON.parse(argumentsJson || "{}");
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  protected parseStructuredOutput<T>(text: string): T {
    if (!text.trim()) throw new Error("structured output was empty");
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      // 错误信息含 "JSON" 以命中 shouldFallbackStructured，触发另一条结构化路径重试
      throw new Error(`Failed to parse structured output as JSON: ${(error as Error).message}`);
    }
  }

  /** 400/422 或报错内容命中结构化输出关键词时，切换另一条结构化路径重试。 */
  protected shouldFallbackStructured(options: StructuredInvokeOptions | undefined, error: unknown): boolean {
    if (options?.signal?.aborted) return false;
    const err = error as any;
    const status = err?.status ?? err?.response?.status ?? err?.cause?.status;
    if (status === 400 || status === 422) return true;
    const message = [
      err?.message,
      err?.code,
      err?.type,
      err?.response?.data && JSON.stringify(err.response.data),
    ].filter(Boolean).join("\n");
    return /400|422|tool|function|structured|schema|response_format|parse|json/i.test(message);
  }
}
