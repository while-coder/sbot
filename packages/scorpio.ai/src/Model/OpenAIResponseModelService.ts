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

  protected override buildChatOpenAIOptions(): ConstructorParameters<typeof ChatOpenAI>[0] {
    return {
      ...super.buildChatOpenAIOptions(),
      useResponsesApi: true,
    };
  }
}
