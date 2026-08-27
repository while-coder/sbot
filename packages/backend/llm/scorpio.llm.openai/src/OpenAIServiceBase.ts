import OpenAI from "openai";
import type { CompletionUsage } from "openai/resources/completions";
import {
  ModelServiceBase,
  type ModelInvokeOptions,
  type TokenUsage,
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
export abstract class OpenAIServiceBase extends ModelServiceBase {
  protected client?: OpenAI;

  initialize(): void {
    if (!this.config.apiKey) throw new Error("OpenAI config missing apiKey");
    this.client = new OpenAI({
      apiKey: this.config.apiKey,
      baseURL: this.config.baseURL,
      fetch: compatibleOpenAIFetch,
    });
    this.getLLMInfo();
  }

  override async dispose(): Promise<void> {
    this.client = undefined;
    await super.dispose();
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
}
