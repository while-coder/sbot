import { ChatOpenAI } from "@langchain/openai";
import { AIMessageChunk } from "@langchain/core/messages";
import { IModelService } from "./IModelService";
import { ModelConfig } from "./types";
import { type ChatMessage } from "../Saver/IAgentSaverService";
import { toChatMessage, toBaseMessages } from "../Saver/messageConverter";

/**
 * OpenAI 模型服务实现
 * 封装 @langchain/openai 的 ChatOpenAI
 */
export class OpenAIModelService implements IModelService {
  protected model?: ChatOpenAI;
  private boundModel?: any;

  constructor(protected config: ModelConfig) {}

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

  async initialize(): Promise<void> {
    this.model = new ChatOpenAI(this.buildChatOpenAIOptions());
  }

  async dispose(): Promise<void> {
    this.model = undefined;
    this.boundModel = undefined;
  }

  async invoke(prompt: string | ChatMessage[]): Promise<ChatMessage> {
    const m = this.boundModel ?? this.model!;
    const input = typeof prompt === 'string' ? prompt : toBaseMessages(prompt);
    const result = await m.invoke(input);
    return toChatMessage(result);
  }

  bindTools(tools: any[]): void {
    this.boundModel = this.model!.bindTools(tools);
  }

  async invokeStructured<T = any>(schema: any, prompt: string | ChatMessage[]): Promise<T> {
    const input = typeof prompt === 'string' ? prompt : toBaseMessages(prompt);
    return this.model!.withStructuredOutput(schema).invoke(input) as Promise<T>;
  }

  async stream(messages: string | ChatMessage[]): Promise<AsyncIterable<ChatMessage>> {
    const m = this.boundModel ?? this.model!;
    const input = typeof messages === 'string' ? messages : toBaseMessages(messages);
    const lcStream = await m.stream(input);
    return (async function* () {
      let accumulated: AIMessageChunk | undefined;
      for await (const chunk of lcStream) {
        accumulated = accumulated ? accumulated.concat(chunk) : (chunk as AIMessageChunk);
        yield toChatMessage(accumulated!);
      }
    })();
  }

  getModel(): any {
    return this.model!;
  }
}
