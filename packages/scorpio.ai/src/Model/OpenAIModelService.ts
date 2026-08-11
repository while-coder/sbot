import { type BaseMessageChunk } from "@langchain/core/messages";
import { ChatOpenAI, ChatOpenAICompletions, type ChatOpenAIFields } from "@langchain/openai";
import { ModelServiceBase } from "./ModelServiceBase";
import { type StructuredInvokeOptions } from "./IModelService";
import { type ChatMessage } from "../Saver/IAgentSaverService";
import { getInvokeConfig, StructuredOutputMethod, toStructuredInput } from "./structuredOutput";

/**
 * 部分 OpenAI 兼容端点不会在首个流式 delta 中返回 role。
 * LangChain 默认会把这种 delta 转成 ChatMessageChunk，导致后续无法按 AI 消息处理；
 * 模型输出在缺少显式 role 时应按 assistant 解析。
 */
class CompatibleChatOpenAICompletions extends ChatOpenAICompletions {
  protected override _convertCompletionsDeltaToBaseMessageChunk(
    delta: Record<string, any>,
    rawResponse: any,
    defaultRole?: any,
  ): BaseMessageChunk {
    return super._convertCompletionsDeltaToBaseMessageChunk(
      delta,
      rawResponse,
      defaultRole ?? "assistant",
    );
  }
}

/**
 * OpenAI 模型服务实现
 * 封装 @langchain/openai 的 ChatOpenAI
 */
export class OpenAIModelService extends ModelServiceBase<ChatOpenAI> {

  protected buildChatOpenAIOptions(): ChatOpenAIFields {
    return {
      configuration: {
        baseURL: this.config.baseURL,
        apiKey: this.config.apiKey,
        // 部分 OpenAI 兼容接口返回 { message/msg/detail }，而不是标准 { error: ... }。
        // OpenAI SDK 会丢弃这些 JSON 的具体内容并只抛出 "status code (no body)"，
        // 因此在 SDK 解析前将非标准错误体包进 error 字段，保留服务端真实原因。
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

    let raw = '';
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
      // 纯文本错误本来就能被 OpenAI SDK 保留，无需改写。
      return response;
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && parsed.error != null) {
      return response;
    }

    const error = parsed && typeof parsed === 'object'
      ? parsed
      : { message: typeof parsed === 'string' ? parsed : raw };
    const headers = new Headers(response.headers);
    headers.set('content-type', 'application/json');
    // 正文已改写，原长度/压缩信息不再有效。
    headers.delete('content-length');
    headers.delete('content-encoding');
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
    const baseURL = (this.config.baseURL ?? '').toLowerCase();
    return !baseURL || baseURL.includes('api.openai.com')
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

  private shouldFallback(
    options: StructuredInvokeOptions | undefined,
    error: unknown,
  ): boolean {
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
