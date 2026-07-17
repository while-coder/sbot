import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ModelServiceBase } from "./ModelServiceBase";
import type { ModelInvokeOptions, StructuredInvokeOptions } from "./IModelService";
import { type ChatMessage } from "../Saver/IAgentSaverService";
import { getInvokeConfig, StructuredOutputMethod, toStructuredInput } from "./structuredOutput";

/**
 * Google Gemini 模型服务实现
 * 封装 @langchain/google-genai 的 ChatGoogleGenerativeAI
 */
export class GeminiModelService extends ModelServiceBase<ChatGoogleGenerativeAI> {
  protected createModel(): ChatGoogleGenerativeAI {
    const opts: Record<string, any> = {
      apiKey: this.config.apiKey,
      baseUrl: this.config.baseURL,
      model: this.config.model,
      apiVersion: this.config.gemini?.apiVersion ?? "v1",
    };
    if (this.config.temperature != null) opts.temperature = this.config.temperature;
    if (this.config.maxTokens != null) opts.maxOutputTokens = this.config.maxTokens;
    return new ChatGoogleGenerativeAI(opts as any);
  }

  async invokeStructured<T = any>(schema: any, prompt: string | ChatMessage[], options?: StructuredInvokeOptions): Promise<T> {
    const method = StructuredOutputMethod.JsonSchema;
    const input = toStructuredInput(prompt, method, schema);
    return this.model!.withStructuredOutput(schema, { method }).invoke(input, getInvokeConfig(options)) as Promise<T>;
  }

  async stream(messages: string | ChatMessage[], options?: ModelInvokeOptions): Promise<AsyncIterable<ChatMessage>> {
    const result = await this.invoke(messages, options);
    return (async function* () {
      yield result;
    })();
  }
  
}
