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
    };
  }

  async initialize(): Promise<void> {
    this.model = new ChatOpenAI(this.buildChatOpenAIOptions());
  }

  async dispose(): Promise<void> {
    this.model = undefined;
  }

  async invoke(prompt: string | ChatMessage[]): Promise<ChatMessage> {
    const input = typeof prompt === 'string' ? prompt : toBaseMessages(prompt);
    const result = await this.model!.invoke(input);
    return toChatMessage(result);
  }

  bindTools(tools: any[]) {
    return this.model!.bindTools(tools) as any;
  }

  withStructuredOutput<T extends Record<string, any> = Record<string, any>>(schema: any) {
    return this.model!.withStructuredOutput<T>(schema) as any;
  }

  async stream(messages: string | ChatMessage[]): Promise<AsyncIterable<ChatMessage>> {
    const input = typeof messages === 'string' ? messages : toBaseMessages(messages);
    const lcStream = await this.model!.stream(input);
    return (async function* () {
      let accumulated: AIMessageChunk | undefined;
      for await (const chunk of lcStream) {
        accumulated = accumulated ? accumulated.concat(chunk) : chunk;
        yield toChatMessage(accumulated);
      }
    })();
  }

  getModel(): any {
    return this.model!;
  }
}
