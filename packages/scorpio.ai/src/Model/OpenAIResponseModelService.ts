import { ChatOpenAI } from "@langchain/openai";
import { ModelConfig } from "./types";
import { OpenAIModelService } from "./OpenAIModelService";

/**
 * OpenAI Responses API 模型服务实现
 * 使用 OpenAI 的 /v1/responses 端点，支持结构化输出和 web_search 等工具
 */
export class OpenAIResponseModelService extends OpenAIModelService {
  constructor(config: ModelConfig) {
    super(config);
  }

  async initialize(): Promise<void> {
    this.model = new ChatOpenAI({
      configuration: {
        baseURL: this.config.baseURL,
        apiKey: this.config.apiKey,
      },
      apiKey: this.config.apiKey,
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      useResponsesApi: true,
    });
  }
}