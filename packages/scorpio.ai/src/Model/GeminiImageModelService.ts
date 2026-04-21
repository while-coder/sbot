import { ModelConfig } from "./types";
import { type ChatMessage, MessageRole } from "../Saver/IAgentSaverService";
import { GeminiModelService } from "./GeminiModelService";

/**
 * Gemini 图片生成模型服务
 * 过滤掉 ToolMessage，仅保留 System/Human 消息
 */
export class GeminiImageModelService extends GeminiModelService {
  constructor(config: ModelConfig) {
    super(config);
  }

  private filterMessages(prompt: string | ChatMessage[]): string | ChatMessage[] {
    if (typeof prompt === 'string') return prompt;
    return prompt.filter(m => m.role === MessageRole.Human || m.role === MessageRole.System);
  }

  override async invoke(prompt: string | ChatMessage[]): Promise<ChatMessage> {
    return super.invoke(this.filterMessages(prompt));
  }

  override async stream(messages: string | ChatMessage[]): Promise<AsyncIterable<ChatMessage>> {
    return super.stream(this.filterMessages(messages));
  }

  override bindTools(_tools: any[]): void {
    // 图片生成模型不支持 tools，忽略
  }
}
