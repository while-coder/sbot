import type { AgentTool } from "scorpio.llm";
import {
  type ChatMessage,
  type ModelConfig,
  type StructuredInvokeOptions,
  MessageRole,
} from "scorpio.llm";
import { GeminiModelService } from "./GeminiModelService";

export class GeminiImageModelService extends GeminiModelService {
  constructor(config: ModelConfig) { super(config); }

  private filterMessages(prompt: string | ChatMessage[]): string | ChatMessage[] {
    if (typeof prompt === "string") return prompt;
    return prompt.filter(message => message.role === MessageRole.Human);
  }

  override async invoke(prompt: string | ChatMessage[], options?: { signal?: AbortSignal }): Promise<ChatMessage> {
    return super.invoke(this.filterMessages(prompt), options);
  }

  override async stream(messages: string | ChatMessage[], options?: { signal?: AbortSignal }): Promise<AsyncIterable<ChatMessage>> {
    return super.stream(this.filterMessages(messages), options);
  }

  override bindTools(_tools: AgentTool[]): void {}

  override async invokeStructured<T = any>(
    _schema: any,
    _prompt: string | ChatMessage[],
    _options?: StructuredInvokeOptions,
  ): Promise<T> {
    throw new Error("Gemini image model does not support structured output");
  }
}
