import { z } from "zod";
import { SystemMessage, HumanMessage } from "langchain";
import { IModelService } from "../../Model";
import { ILoggerService, ILogger } from "../../Logger";
import { inject } from "../../DI";
import { T_EvaluatorSystemPrompt } from "../../Core";
import { IMemoryEvaluator, EvaluationResult } from "./IMemoryEvaluator";

const EvaluationSchema = z.object({
  importance: z.number().min(0).max(1).describe("Importance score between 0.0 and 1.0"),
  reasoning: z.string().describe("Brief justification for the score"),
});

/**
 * LLM-driven importance evaluator
 * Uses a language model to assess memory importance
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
    @inject(T_EvaluatorSystemPrompt) private systemPrompt: string,
    @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
  ) {
    this.logger = loggerService?.getLogger("MemoryEvaluator");
  }

  /**
   * Evaluate the importance of a piece of text
   */
  async evaluate(content: string): Promise<EvaluationResult> {
    try {
      return await this.modelService.withStructuredOutput<EvaluationResult>(EvaluationSchema).invoke([
        new SystemMessage(this.systemPrompt),
        new HumanMessage(content),
      ]);
    } catch (error: any) {
      this.logger?.warn(`LLM importance evaluation failed: ${error.message}`);
      return { importance: 0.5, reasoning: "Evaluation failed, using default" };
    }
  }
}
