import type { BaseMessage, BaseMessageChunk } from "@langchain/core/messages";
import { ChatOpenAI, ChatOpenAICompletions, type ChatOpenAIFields } from "@langchain/openai";
import {
  type ChatMessage,
  MessageRole,
  type StructuredInvokeOptions,
  ModelServiceBase,
  StructuredOutputMethod,
  getInvokeConfig,
  toStructuredInput,
} from "scorpio.llm";

/** OpenAI Chat Completions 已知 role，之外的（如部分网关的 "model"）统一按 assistant 处理。 */
const KNOWN_ROLES = new Set(["system", "developer", "user", "assistant", "tool", "function"]);

class CompatibleChatOpenAICompletions extends ChatOpenAICompletions {
  protected override _convertCompletionsDeltaToBaseMessageChunk(
    delta: Record<string, any>,
    rawResponse: any,
    defaultRole?: any,
  ): BaseMessageChunk {
    // 非标准 role 会被 langchain 包装成 ChatMessageChunk，导致 tool_calls/usage
    // 无法按 AIMessageChunk 累加，这里归一为 assistant。
    if (delta.role != null && !KNOWN_ROLES.has(delta.role)) delta = { ...delta, role: "assistant" };
    if (defaultRole != null && !KNOWN_ROLES.has(defaultRole)) defaultRole = "assistant";
    return super._convertCompletionsDeltaToBaseMessageChunk(delta, rawResponse, defaultRole ?? "assistant");
  }
}

export class OpenAIModelService extends ModelServiceBase<ChatOpenAI> {
  protected override prepareInput(input: string | ChatMessage[]): string | BaseMessage[] {
    if (typeof input === "string") return input;

    // OpenAI accepts text-part arrays for tool messages, but some compatible
    // gateways only accept a plain string. Normalize at the provider boundary
    // so persisted histories with multi-part tool results work as well.
    const messages = input.map(message => {
      if (message.role !== MessageRole.Tool || typeof message.content === "string") return message;
      if (!message.content.every(part => part.type === "text" && typeof part.text === "string")) return message;
      return {
        ...message,
        content: message.content.map(part => (part as { text: string }).text).join("\n\n"),
      };
    });

    return super.prepareInput(messages);
  }

  protected buildChatOpenAIOptions(): ChatOpenAIFields {
    return {
      configuration: {
        baseURL: this.config.baseURL,
        apiKey: this.config.apiKey,
        fetch: OpenAIModelService.compatibleFetch,
      },
      apiKey: this.config.apiKey,
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      streamUsage: true,
    };
  }

  private static async compatibleFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
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

  protected createModel(): ChatOpenAI {
    const options = this.buildChatOpenAIOptions();
    return new ChatOpenAI({
      ...options,
      completions: new CompatibleChatOpenAICompletions(options),
    });
  }

  async invokeStructured<T = any>(schema: any, prompt: string | ChatMessage[], options?: StructuredInvokeOptions): Promise<T> {
    const method = this.defaultStructuredMethod();
    try {
      return await this.invokeStructuredWithMethod<T>(schema, prompt, method, options);
    } catch (error) {
      const fallbackMethod = this.getFallbackStructuredMethod(method);
      if (!fallbackMethod || !this.shouldFallback(options, error)) throw error;
      return this.invokeStructuredWithMethod<T>(schema, prompt, fallbackMethod, options);
    }
  }

  private defaultStructuredMethod(): StructuredOutputMethod {
    const info = this.getLLMInfo();
    // 目录明确声明原生结构化输出时，优先走 JSON mode；否则官方 OpenAI
    // 保留函数调用作为兼容性更好的默认路径，失败时仍会自动切换。
    if (info.structuredOutput) return StructuredOutputMethod.JsonMode;
    const baseURL = (this.config.baseURL ?? "").toLowerCase();
    return info.toolCall && (!baseURL || baseURL.includes("api.openai.com"))
      ? StructuredOutputMethod.FunctionCalling
      : StructuredOutputMethod.JsonMode;
  }

  private getFallbackStructuredMethod(method: StructuredOutputMethod): StructuredOutputMethod | undefined {
    if (method === StructuredOutputMethod.FunctionCalling) return StructuredOutputMethod.JsonMode;
    if (method === StructuredOutputMethod.JsonMode) return StructuredOutputMethod.FunctionCalling;
    return undefined;
  }

  private async invokeStructuredWithMethod<T = any>(
    schema: any,
    prompt: string | ChatMessage[],
    method: StructuredOutputMethod,
    options?: StructuredInvokeOptions,
  ): Promise<T> {
    const input = toStructuredInput(prompt, method, schema);
    const structured = this.model!.withStructuredOutput(schema, {
      method,
      ...(method !== StructuredOutputMethod.JsonMode && options?.strict !== undefined && { strict: options.strict }),
    });
    return structured.invoke(input, getInvokeConfig(options)) as Promise<T>;
  }

  private shouldFallback(options: StructuredInvokeOptions | undefined, error: unknown): boolean {
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
