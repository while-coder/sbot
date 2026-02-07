import { inject, transient } from "../Core";
import { IModelService, MODEL_NAME, ModelServiceFactory } from "../Model";
import { LoggerService } from "../LoggerService";

const logger = LoggerService.getLogger("ImportanceEvaluator.ts");

/**
 * 评估结果
 */
export interface ImportanceEvaluation {
  score: number;              // 重要性评分 (0-1)
  reasoning: string;          // 评分理由
  category?: string;          // 记忆类别
  tags?: string[];           // 建议的标签
}

/**
 * LLM 驱动的智能重要性评估器
 * 使用语言模型判断记忆的重要性
 *
 * @example
 * ```ts
 * const evaluator = new ImportanceEvaluator("gpt-4", modelFactory);
 * const result = await evaluator.evaluate("some text");
 * ```
 */
export class ImportanceEvaluator {
  constructor(private modelService: IModelService) {}

  /**
   * 评估文本的重要性
   * @param content 要评估的文本内容
   * @param context 可选的上下文信息
   * @returns 重要性评估结果
   */
  async evaluate(content: string, context?: string): Promise<ImportanceEvaluation> {
    try {
      const prompt = this.buildEvaluationPrompt(content, context);
      const response = await this.modelService.invoke(prompt);
      const result = this.parseResponse(response.text);

      logger.debug(`LLM 重要性评估: ${content.substring(0, 50)}... -> ${result.score.toFixed(2)}`);
      return result;
    } catch (error: any) {
      logger.warn(`LLM 重要性评估失败，使用启发式方法: ${error.message}`);
      return this.heuristicEvaluation(content);
    }
  }

  /**
   * 批量评估多个文本的重要性
   */
  async evaluateBatch(items: Array<{ content: string; context?: string }>): Promise<ImportanceEvaluation[]> {
    if (items.length === 0) {
      return [];
    }

    try {
      const prompt = this.buildBatchEvaluationPrompt(items);
      const response = await this.modelService.invoke(prompt);
      const results = this.parseBatchResponse(response.text, items.length);

      logger.debug(`批量评估了 ${items.length} 个记忆的重要性`);
      return results;
    } catch (error: any) {
      logger.warn(`批量LLM评估失败，使用启发式方法: ${error.message}`);
      return items.map(item => this.heuristicEvaluation(item.content));
    }
  }

  // ===== 私有方法 =====

  private buildEvaluationPrompt(content: string, context?: string): string {
    return `你是一个记忆重要性评估专家。请评估以下文本作为长期记忆的重要性。

${context ? `上下文信息：${context}\n\n` : ''}要评估的内容：
${content}

请按以下 JSON 格式返回评估结果（只返回 JSON，不要其他内容）：
{
  "score": 0.0-1.0 的数值，表示重要性（0=不重要，1=极其重要）,
  "reasoning": "简短的评分理由",
  "category": "记忆类别，如：事实、偏好、决策、对话等",
  "tags": ["相关的标签"]
}

评分标准：
- 0.0-0.3: 临时信息、闲聊、不重要的细节
- 0.4-0.6: 一般对话、普通问题、常见信息
- 0.7-0.8: 重要决策、用户偏好、关键事实
- 0.9-1.0: 极其重要的信息、永久性决策、核心价值观`;
  }

  private buildBatchEvaluationPrompt(items: Array<{ content: string; context?: string }>): string {
    const itemsList = items.map((item, index) =>
      `[${index + 1}] ${item.content}${item.context ? ` (上下文: ${item.context})` : ''}`
    ).join('\n\n');

    return `你是一个记忆重要性评估专家。请评估以下 ${items.length} 条文本作为长期记忆的重要性。

要评估的内容：
${itemsList}

请按以下 JSON 数组格式返回评估结果（只返回 JSON 数组，不要其他内容）：
[
  {
    "index": 1,
    "score": 0.0-1.0,
    "reasoning": "简短理由",
    "category": "类别",
    "tags": ["标签"]
  },
  ...
]

评分标准：
- 0.0-0.3: 临时信息、闲聊
- 0.4-0.6: 一般对话、普通问题
- 0.7-0.8: 重要决策、用户偏好
- 0.9-1.0: 极其重要的信息`;
  }

  private parseResponse(response: string): ImportanceEvaluation {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error("未找到有效的 JSON 响应");
      }

      const result = JSON.parse(jsonMatch[0]);
      return {
        score: Math.max(0, Math.min(1, parseFloat(result.score))),
        reasoning: result.reasoning || "无理由",
        category: result.category,
        tags: Array.isArray(result.tags) ? result.tags : []
      };
    } catch (error: any) {
      logger.warn(`解析LLM响应失败: ${error.message}`);
      return this.heuristicEvaluation(response);
    }
  }

  private parseBatchResponse(response: string, expectedCount: number): ImportanceEvaluation[] {
    try {
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error("未找到有效的 JSON 数组响应");
      }

      const results = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(results) || results.length !== expectedCount) {
        throw new Error(`响应数量不匹配: 期望 ${expectedCount}，实际 ${results.length}`);
      }

      return results.map(result => ({
        score: Math.max(0, Math.min(1, parseFloat(result.score))),
        reasoning: result.reasoning || "无理由",
        category: result.category,
        tags: Array.isArray(result.tags) ? result.tags : []
      }));
    } catch (error: any) {
      logger.warn(`解析批量LLM响应失败: ${error.message}`);
      return Array(expectedCount).fill(null).map(() => ({
        score: 0.5,
        reasoning: "LLM评估失败，使用默认值",
        tags: []
      }));
    }
  }

  private heuristicEvaluation(content: string): ImportanceEvaluation {
    let score = 0.5;
    const tags: string[] = [];
    let category = "一般信息";
    const reasons: string[] = [];

    if (content.length > 200) {
      score += 0.1;
      reasons.push("内容较长");
    }

    const highImportanceKeywords = [
      '重要', '关键', '务必', '记住', '不要忘记', '永远', '总是',
      'important', 'remember', 'critical', 'must', 'never forget', 'always'
    ];
    if (highImportanceKeywords.some(k => content.toLowerCase().includes(k.toLowerCase()))) {
      score += 0.3;
      tags.push('重要');
      reasons.push("包含重要性关键词");
    }

    const decisionKeywords = ['决定', '选择', '喜欢', '偏好', '倾向', '不喜欢', 'prefer', 'like', 'dislike', 'choose'];
    if (decisionKeywords.some(k => content.toLowerCase().includes(k.toLowerCase()))) {
      score += 0.2;
      category = "偏好或决策";
      tags.push('偏好');
      reasons.push("涉及偏好或决策");
    }

    const techKeywords = ['使用', '工具', '语言', '框架', '技术', 'use', 'tool', 'language', 'framework', 'technology'];
    if (techKeywords.some(k => content.toLowerCase().includes(k.toLowerCase()))) {
      score += 0.15;
      tags.push('技术');
      reasons.push("涉及技术栈");
    }

    const personalKeywords = ['我的', '我是', '我叫', '生日', '联系', 'my', 'I am', 'my name', 'birthday', 'contact'];
    if (personalKeywords.some(k => content.toLowerCase().includes(k.toLowerCase()))) {
      score += 0.2;
      category = "个人信息";
      tags.push('个人');
      reasons.push("包含个人信息");
    }

    if (content.includes('?') || content.includes('？')) {
      score += 0.1;
      tags.push('问题');
      reasons.push("包含问题");
    }

    if (/\d+/.test(content)) {
      score += 0.05;
      reasons.push("包含具体数据");
    }

    score = Math.min(score, 1.0);

    return {
      score,
      reasoning: reasons.join('; ') || '基于启发式规则评估',
      category,
      tags
    };
  }
}
