import { z } from "zod";
import { SystemMessage, HumanMessage } from "langchain";
import { IModelService } from "../../Model";
import { ILoggerService, ILogger } from "../../Logger";
import { inject } from "scorpio.di";
import { T_ExtractorSystemPrompt } from "../../Core";
import { IMemoryExtractor, ExtractionResult } from "./IMemoryExtractor";

const ExtractionSchema = z.object({
  results: z.array(z.object({
    content: z.string().describe("A concise, self-contained knowledge statement"),
    importance: z.number().min(0).max(1).describe("Importance score 0-1"),
  })).describe("Extracted knowledge points, empty array if nothing worth remembering"),
});

/**
 * LLM-driven conversation knowledge extractor
 * Extracts key facts, preferences, decisions, and other knowledge points from conversations
 */
export class MemoryExtractor implements IMemoryExtractor {
  private logger?: ILogger;

  constructor(
    @inject(IModelService) private modelService: IModelService,
    @inject(T_ExtractorSystemPrompt) private systemPrompt: string,
    @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
  ) {
    this.logger = loggerService?.getLogger("MemoryExtractor");
  }

  /**
   * Extract knowledge points from a conversation
   * @returns Array of extracted knowledge points, empty array if nothing worth remembering
   */
  async extract(userMessage: string, assistantMessage?: string[]): Promise<ExtractionResult[]> {
    try {
      const parts = assistantMessage?.filter(Boolean);
      const human = parts?.length
        ? `<user>${userMessage}</user>\n${parts.map(m => `<assistant>${m}</assistant>`).join("\n")}`
        : `<user>${userMessage}</user>`;
      const { results } = await this.modelService.withStructuredOutput(ExtractionSchema).invoke([
        new SystemMessage(this.systemPrompt),
        new HumanMessage(human),
      ]);
      return results;
    } catch (error: any) {
      this.logger?.warn(`LLM knowledge extraction failed: ${error.message}`);
      return [];
    }
  }
}
