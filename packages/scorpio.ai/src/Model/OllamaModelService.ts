import { ChatOllama } from "@langchain/ollama";
import { AIMessageChunk } from "@langchain/core/messages";
import { IModelService } from "./IModelService";
import { ModelConfig } from "./types";
import { type ChatMessage } from "../Saver/IAgentSaverService";
import { toChatMessage, toBaseMessages } from "../Saver/messageConverter";

/**
 * Ollama 模型服务实现
 * 封装 @langchain/ollama 的 ChatOllama，支持本地部署模型
 */
export class OllamaModelService implements IModelService {
  private model?: ChatOllama;

  constructor(private config: ModelConfig) {}

  async initialize(): Promise<void> {
    this.model = new ChatOllama({
      baseUrl: this.config.baseURL ?? "http://localhost:11434",
      model: this.config.model,
      temperature: this.config.temperature,
      numPredict: this.config.maxTokens,
    });
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

  withStructuredOutput(schema: any) {
    return this.model!.withStructuredOutput(schema) as any;
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
