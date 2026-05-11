import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { IModelService } from "./IModelService";
import { ModelConfig } from "./types";
import { type ChatMessage } from "../Saver/IAgentSaverService";
import { toChatMessage, toBaseMessages } from "../Saver/messageConverter";

/**
 * Google Gemini 模型服务实现
 * 封装 @langchain/google-genai 的 ChatGoogleGenerativeAI
 */
export class GeminiModelService implements IModelService {
  private model?: ChatGoogleGenerativeAI;
  private boundModel?: any;

  constructor(private config: ModelConfig) {}

  get contextWindow(): number | undefined { return this.config.contextWindow; }

  async initialize(): Promise<void> {
    const opts: Record<string, any> = {
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseURL,
      model: this.config.model,
      apiVersion: this.config.gemini?.apiVersion ?? "v1",
    };
    if (this.config.temperature != null) opts.temperature = this.config.temperature;
    if (this.config.maxTokens != null) opts.maxOutputTokens = this.config.maxTokens;
    this.model = new ChatGoogleGenerativeAI(opts as any);
  }

  async dispose(): Promise<void> {
    this.model = undefined;
    this.boundModel = undefined;
  }

  async invoke(prompt: string | ChatMessage[], options?: { signal?: AbortSignal }): Promise<ChatMessage> {
    const m = this.boundModel ?? this.model!;
    const input = typeof prompt === 'string' ? prompt : toBaseMessages(prompt);
    const result = await m.invoke(input, options?.signal ? { signal: options.signal } : undefined);
    return toChatMessage(result);
  }

  bindTools(tools: any[]): void {
    this.boundModel = this.model!.bindTools(tools);
  }

  async invokeStructured<T = any>(schema: any, prompt: string | ChatMessage[], options?: { signal?: AbortSignal }): Promise<T> {
    const input = typeof prompt === 'string' ? prompt : toBaseMessages(prompt);
    return this.model!.withStructuredOutput(schema).invoke(input, options?.signal ? { signal: options.signal } : undefined) as Promise<T>;
  }

  async stream(messages: string | ChatMessage[], options?: { signal?: AbortSignal }): Promise<AsyncIterable<ChatMessage>> {
    const result = await this.invoke(messages, options);
    return (async function* () {
      yield result;
    })();
  }

  getModel(): any {
    return this.model!;
  }
}
