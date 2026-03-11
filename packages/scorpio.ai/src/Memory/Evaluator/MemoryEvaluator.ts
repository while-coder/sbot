import { z } from "zod";
import { SystemMessage, HumanMessage } from "langchain";
import { IModelService } from "../../Model";
import { ILoggerService, ILogger } from "../../Logger";
import { inject } from "../../DI";
import { IMemoryEvaluator, EvaluationResult } from "./IMemoryEvaluator";
import { MEMORY_SCORE_CRITERIA } from "../MemoryPrompts";

const EvaluationSchema = z.object({
  importance: z.number().min(0).max(1).describe("Importance score between 0.0 and 1.0"),
  reasoning: z.string().describe("Brief justification for the score"),
});

const SYSTEM_PROMPT = `You are a memory importance evaluator. Given a piece of text, assess how valuable it is to store as a long-term memory.

Consider:
- Is this a lasting fact, preference, decision, or instruction — or just transient noise?
- Would forgetting this cause problems in future conversations?
- Is the information specific to the user/project, or generic common knowledge?

${MEMORY_SCORE_CRITERIA}`;

/**
 * LLM 驱动的智能重要性评估器
 * 使用语言模型判断记忆的重要性
 *
 * @example
 * ```ts
 * const evaluator = new MemoryEvaluator("gpt-4", modelFactory);
 * const result = await evaluator.evaluate("some text");
 * ```
 */
export class MemoryEvaluator implements IMemoryEvaluator {
  private logger?: ILogger;

  constructor(
    @inject(IModelService) private modelService: IModelService,
    @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService
  ) {
    this.logger = loggerService?.getLogger("MemoryEvaluator");
  }

  /**
   * 评估文本的重要性
   * @param content 要评估的文本内容
   * @param context 可选的上下文信息
   * @returns 重要性评估结果
   */
  async evaluate(content: string): Promise<EvaluationResult> {
    try {
      return await this.modelService.withStructuredOutput<EvaluationResult>(EvaluationSchema).invoke([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(content),
      ]);
    } catch (error: any) {
      this.logger?.warn(`LLM 重要性评估失败: ${error.message}`);
      return { importance: 0.5, reasoning: "评估失败，使用默认值" };
    }
  }
}
