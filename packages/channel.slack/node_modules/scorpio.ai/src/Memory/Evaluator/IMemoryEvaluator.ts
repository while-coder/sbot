/**
 * 评估结果
 */
export interface EvaluationResult {
  importance: number;         // 重要性评分 (0-1)
  reasoning: string;          // 评分理由
}

/**
 * 记忆评估器接口
 * 负责评估记忆的重要性
 */
export interface IMemoryEvaluator {
  /**
   * 评估文本的重要性
   * @param content 要评估的文本内容
   * @returns 重要性评估结果
   */
  evaluate(content: string): Promise<EvaluationResult>;

}

/**
 * IMemoryEvaluator 的依赖注入 token
 * 使用 Symbol 确保唯一性，避免命名冲突
 */
export const IMemoryEvaluator = Symbol("IMemoryEvaluator");
