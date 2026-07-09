import { ChatOpenAI } from "@langchain/openai";
import { AIMessageChunk } from "@langchain/core/messages";
import { IModelService, type ModelInvokeOptions, type StructuredInvokeOptions } from "./IModelService";
import { ModelConfig } from "./types";
import { type ChatMessage } from "../Saver/IAgentSaverService";
import { toChatMessage, toBaseMessages } from "../Saver/messageConverter";
import { getInvokeConfig, StructuredOutputMethod, toStructuredInput } from "./structuredOutput";

/**
 * OpenAI 模型服务实现
 * 封装 @langchain/openai 的 ChatOpenAI
 */
export class OpenAIModelService implements IModelService {
  protected model?: ChatOpenAI;
  private boundModel?: any;

  constructor(public readonly config: ModelConfig) {}

  protected buildChatOpenAIOptions(): ConstructorParameters<typeof ChatOpenAI>[0] {
    return {
      configuration: {
        baseURL: this.config.baseURL,
        apiKey: this.config.apiKey,
      },
      apiKey: this.config.apiKey,
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      streamUsage: true,
    };
  }

  initialize(): void {
    this.model = new ChatOpenAI(this.buildChatOpenAIOptions());
  }

  async dispose(): Promise<void> {
    this.model = undefined;
    this.boundModel = undefined;
  }

  async invoke(prompt: string | ChatMessage[], options?: ModelInvokeOptions): Promise<ChatMessage> {
    const m = this.boundModel ?? this.model!;
    const input = typeof prompt === 'string' ? prompt : toBaseMessages(prompt);
    const result = await m.invoke(input, options?.signal ? { signal: options.signal } : undefined);
    return toChatMessage(result);
  }

  bindTools(tools: any[]): void {
    this.boundModel = this.model!.bindTools(tools);
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

  async stream(messages: string | ChatMessage[], options?: ModelInvokeOptions): Promise<AsyncIterable<ChatMessage>> {
    const m = this.boundModel ?? this.model!;
    const input = typeof messages === 'string' ? messages : toBaseMessages(messages);
    const lcStream = await m.stream(input, options?.signal ? { signal: options.signal } : undefined);
    return (async function* () {
      let accumulated: AIMessageChunk | undefined;
      for await (const chunk of lcStream) {
        accumulated = accumulated ? accumulated.concat(chunk) : (chunk as AIMessageChunk);
        yield toChatMessage(accumulated!);
      }
    })();
  }

}
