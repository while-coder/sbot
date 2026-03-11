/**
 * 提取的知识点
 */
export interface ExtractionResult {
  content: string;              // 精炼后的知识点
  importance: number;           // 重要性 (0-1)
}

/**
 * 记忆提取器接口
 * 负责从对话中提取关键知识点
 */
export interface IMemoryExtractor {
  /**
   * 从对话中提取知识点
   * @param userMessage 用户消息
   * @param assistantMessage 助手消息（可选，取决于 MemoryMode 配置）
   * @returns 提取的知识点数组，空数组表示无需记忆
   */
  extract(userMessage: string, assistantMessage?: string[]): Promise<ExtractionResult[]>;
}

/**
 * IMemoryExtractor 的依赖注入 token
 * 使用 Symbol 确保唯一性，避免命名冲突
 */
export const IMemoryExtractor = Symbol("IMemoryExtractor");
