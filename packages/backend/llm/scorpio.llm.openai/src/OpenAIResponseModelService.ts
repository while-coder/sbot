import type { ChatOpenAIFields } from "@langchain/openai";
import type { ModelConfig } from "scorpio.llm";
import { OpenAIModelService } from "./OpenAIModelService";

export class OpenAIResponseModelService extends OpenAIModelService {
  constructor(config: ModelConfig) {
    super(config);
  }

  protected override buildChatOpenAIOptions(): ChatOpenAIFields {
    return { ...super.buildChatOpenAIOptions(), useResponsesApi: true };
  }
}
