import { ChatOllama } from "@langchain/ollama";
import {
  type ChatMessage,
  type StructuredInvokeOptions,
  ModelServiceBase,
  StructuredOutputMethod,
  getInvokeConfig,
  toStructuredInput,
} from "scorpio.llm";

export class OllamaModelService extends ModelServiceBase<ChatOllama> {
  protected createModel(): ChatOllama {
    return new ChatOllama({
      baseUrl: this.config.baseURL,
      model: this.config.model,
      temperature: this.config.temperature,
      numPredict: this.config.maxTokens,
    });
  }

  async invokeStructured<T = any>(schema: any, prompt: string | ChatMessage[], options?: StructuredInvokeOptions): Promise<T> {
    const method = StructuredOutputMethod.JsonSchema;
    const input = toStructuredInput(prompt, method, schema);
    return this.model!.withStructuredOutput(schema, { method }).invoke(input, getInvokeConfig(options)) as Promise<T>;
  }
}
