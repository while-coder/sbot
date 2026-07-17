import { ChatOllama } from "@langchain/ollama";
import { ModelServiceBase } from "./ModelServiceBase";
import type { StructuredInvokeOptions } from "./IModelService";
import { type ChatMessage } from "../Saver/IAgentSaverService";
import { getInvokeConfig, StructuredOutputMethod, toStructuredInput } from "./structuredOutput";

/**
 * Ollama 模型服务实现
 * 封装 @langchain/ollama 的 ChatOllama，支持本地部署模型
 */
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
