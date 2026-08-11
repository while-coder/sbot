import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import {
  type ChatMessage,
  type ModelInvokeOptions,
  type StructuredInvokeOptions,
  ModelServiceBase,
  StructuredOutputMethod,
  getInvokeConfig,
  toStructuredInput,
} from "scorpio.llm";

export class GeminiModelService extends ModelServiceBase<ChatGoogleGenerativeAI> {
  protected createModel(): ChatGoogleGenerativeAI {
    const options: Record<string, any> = {
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseURL,
      model: this.config.model,
      apiVersion: this.config.gemini?.apiVersion ?? "v1",
    };
    if (this.config.temperature != null) options.temperature = this.config.temperature;
    if (this.config.maxTokens != null) options.maxOutputTokens = this.config.maxTokens;
    return new ChatGoogleGenerativeAI(options as any);
  }

  async invokeStructured<T = any>(schema: any, prompt: string | ChatMessage[], options?: StructuredInvokeOptions): Promise<T> {
    const method = StructuredOutputMethod.JsonSchema;
    const input = toStructuredInput(prompt, method, schema);
    return this.model!.withStructuredOutput(schema, { method }).invoke(input, getInvokeConfig(options)) as Promise<T>;
  }

  async stream(messages: string | ChatMessage[], options?: ModelInvokeOptions): Promise<AsyncIterable<ChatMessage>> {
    const result = await this.invoke(messages, options);
    return (async function* () { yield result; })();
  }
}
