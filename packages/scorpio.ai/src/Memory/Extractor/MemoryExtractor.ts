import { z } from "zod";
import { SystemMessage, HumanMessage } from "langchain";
import { IModelService } from "../../Model";
import { ILoggerService, ILogger } from "../../Logger";
import { inject } from "../../DI";
import { IMemoryExtractor, ExtractionResult } from "./IMemoryExtractor";
import { MEMORY_SCORE_CRITERIA } from "../MemoryPrompts";

const ExtractionSchema = z.object({
  results: z.array(z.object({
    content: z.string().describe("A concise, self-contained knowledge statement"),
    importance: z.number().min(0).max(1).describe("Importance score 0-1"),
  })).describe("Extracted knowledge points, empty array if nothing worth remembering"),
});

const SYSTEM_PROMPT = `You are a knowledge extraction expert. Distill conversations into discrete, long-term-worthy knowledge points.

Guidelines:
- Extract facts, preferences, decisions, instructions, and project context
- Each point must be a self-contained statement — understandable without the original conversation
- Merge closely related details into one point rather than splitting them
- Skip greetings, pleasantries, transient questions, and anything easily re-derived
- Return an empty array when nothing is worth remembering

${MEMORY_SCORE_CRITERIA}`;

/**
 * LLM 驱动的对话知识提取器
 * 从对话中提取关键事实、偏好、决策等知识点
 */
export class MemoryExtractor implements IMemoryExtractor {
  private logger?: ILogger;

  constructor(
    @inject(IModelService) private modelService: IModelService,
    @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService
  ) {
    this.logger = loggerService?.getLogger("MemoryExtractor");
  }

  /**
   * 从对话中提取知识点
   * @returns 提取的知识点数组，空数组表示无需记忆
   */
  async extract(userMessage: string, assistantMessage?: string[]): Promise<ExtractionResult[]> {
    try {
      const parts = assistantMessage?.filter(Boolean);
      const human = parts?.length
        ? `<user>${userMessage}</user>\n${parts.map(m => `<assistant>${m}</assistant>`).join("\n")}`
        : `<user>${userMessage}</user>`;
      const { results } = await this.modelService.withStructuredOutput<{ results: ExtractionResult[] }>(ExtractionSchema).invoke([
        new SystemMessage(SYSTEM_PROMPT),
        new HumanMessage(human),
      ]);
      return results;
    } catch (error: any) {
      this.logger?.warn(`LLM 知识提取失败: ${error.message}`);
      return [];
    }
  }
}
