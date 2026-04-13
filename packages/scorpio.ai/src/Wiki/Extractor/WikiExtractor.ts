import { z } from "zod";
import { IModelService } from "../../Model";
import { MessageRole, type ChatMessage } from "../../Saver";
import { ILoggerService, ILogger } from "../../Logger";
import { inject } from "scorpio.di";
import { T_WikiExtractorSystemPrompt } from "../../Core";
import { IWikiExtractor } from "./IWikiExtractor";
import { ExtractedKnowledge } from "../Types";

const WikiExtractionSchema = z.object({
  results: z.array(z.object({
    title: z.string().describe("Concise topic title for the knowledge page"),
    content: z.string().describe("Structured markdown content for the wiki page"),
    tags: z.array(z.string()).describe("Categorization tags"),
    shouldMergeWith: z.string().optional().describe("Existing page title to merge into, if similar topic exists"),
  })).describe("Extracted knowledge pages, empty array if nothing worth persisting as wiki"),
});

/**
 * LLM-driven wiki knowledge extractor
 * Analyzes conversations and extracts structured knowledge as wiki pages
 */
export class WikiExtractor implements IWikiExtractor {
  private logger?: ILogger;

  constructor(
    @inject(IModelService) private modelService: IModelService,
    @inject(T_WikiExtractorSystemPrompt) private systemPrompt: string,
    @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
  ) {
    this.logger = loggerService?.getLogger("WikiExtractor");
  }

  /**
   * Extract structured knowledge from a conversation
   * @returns Array of extracted knowledge pages, empty array if nothing worth persisting
   */
  async extract(
    userMessage: string,
    assistantMessages: string[],
    existingTitles: string[],
  ): Promise<ExtractedKnowledge[]> {
    try {
      const parts = assistantMessages?.filter(Boolean);
      let human = parts?.length
        ? `<user>${userMessage}</user>\n${parts.map(m => `<assistant>${m}</assistant>`).join("\n")}`
        : `<user>${userMessage}</user>`;

      if (existingTitles.length > 0) {
        human += `\n<existing-wiki-titles>\n${existingTitles.join("\n")}\n</existing-wiki-titles>`;
      }

      const messages: ChatMessage[] = [
        { role: MessageRole.System, content: this.systemPrompt },
        { role: MessageRole.Human, content: human },
      ];
      const { results } = await this.modelService.invokeStructured<{ results: ExtractedKnowledge[] }>(WikiExtractionSchema, messages);
      return results;
    } catch (error: any) {
      this.logger?.warn(`Wiki knowledge extraction failed: ${error.message}`);
      return [];
    }
  }
}
