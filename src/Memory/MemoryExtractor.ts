import { IModelService } from "../Model";
import { LoggerService } from "../LoggerService";

const logger = LoggerService.getLogger("MemoryExtractor.ts");

/**
 * 知识分类
 */
export enum FactCategory {
  FACT = "fact",                // 事实: "用户的名字是张伟"
  PREFERENCE = "preference",    // 偏好: "用户偏好深色模式"
  DECISION = "decision",        // 决策: "项目决定使用 PostgreSQL"
  INSTRUCTION = "instruction",  // 指令: "总是用中文回复"
  CONTEXT = "context"           // 上下文: "正在开发一个电商平台"
}

/**
 * 提取的知识点
 */
export interface ExtractedFact {
  content: string;              // 精炼后的知识点
  category: FactCategory;       // 分类
  importance: number;           // 重要性 (0-1)
  tags: string[];               // 标签
}

/**
 * LLM 驱动的对话知识提取器
 * 从对话中提取关键事实、偏好、决策等知识点
 */
export class MemoryExtractor {
  constructor(private modelService: IModelService) {}

  /**
   * 从对话中提取知识点
   * @returns 提取的知识点数组，空数组表示无需记忆
   */
  async extract(userMessage: string, assistantMessage: string): Promise<ExtractedFact[]> {
    try {
      const prompt = this.buildExtractionPrompt(userMessage, assistantMessage);
      const response = await this.modelService.invoke(prompt);
      return this.parseResponse(response.text);
    } catch (error: any) {
      logger.warn(`LLM 知识提取失败: ${error.message}`);
      return [];
    }
  }

  private buildExtractionPrompt(userMessage: string, assistantMessage: string): string {
    return `你是一个知识提取专家。从以下对话中提取值得长期记忆的关键信息。

对话内容：
用户: ${userMessage}
助手: ${assistantMessage}

请提取对话中的关键事实、用户偏好、决策、指令或项目上下文。每个知识点应该是一个独立的、简洁的陈述句。

规则：
- 只提取有长期价值的信息，忽略闲聊、问候、临时性内容
- 每个知识点必须是独立可理解的，不依赖对话上下文
- 如果对话没有任何值得记忆的内容，返回空数组 []
- 重要性评分: 0.3以下=不重要, 0.4-0.6=一般, 0.7-0.8=重要, 0.9-1.0=极重要

请只返回 JSON 数组，不要其他内容：
[
  {
    "content": "简洁的知识点陈述",
    "category": "fact|preference|decision|instruction|context",
    "importance": 0.0-1.0,
    "tags": ["标签"]
  }
]`;
  }

  private parseResponse(response: string): ExtractedFact[] {
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        return [];
      }

      const results = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(results)) {
        return [];
      }

      return results
        .filter((item: any) => item.content && typeof item.content === 'string')
        .map((item: any) => ({
          content: item.content.trim(),
          category: this.parseCategory(item.category),
          importance: Math.max(0, Math.min(1, parseFloat(item.importance) || 0.5)),
          tags: Array.isArray(item.tags) ? item.tags : []
        }));
    } catch (error: any) {
      logger.warn(`解析知识提取结果失败: ${error.message}`);
      return [];
    }
  }

  private parseCategory(value: string): FactCategory {
    const map: Record<string, FactCategory> = {
      fact: FactCategory.FACT,
      preference: FactCategory.PREFERENCE,
      decision: FactCategory.DECISION,
      instruction: FactCategory.INSTRUCTION,
      context: FactCategory.CONTEXT,
    };
    return map[value] ?? FactCategory.FACT;
  }
}
