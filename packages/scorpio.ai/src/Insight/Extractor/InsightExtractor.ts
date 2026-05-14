import { z } from "zod";
import { IModelService } from "../../Model";
import { MessageRole, type ChatMessage } from "../../Saver";
import { ILoggerService, ILogger } from "../../Logger";
import { inject } from "scorpio.di";
import { T_InsightExtractorSystemPrompt } from "../../Core";
import { IInsightExtractor, ExtractedInsight } from "./IInsightExtractor";

const InsightExtractionSchema = z.object({
    results: z.array(z.object({
        name: z.string().describe("Insight name in kebab-case"),
        description: z.string().describe("Brief one-line description"),
        content: z.string().describe("Markdown body content"),
        action: z.enum(['create', 'patch']).describe("Create new or patch existing"),
        patchTarget: z.string().optional().describe("Existing insight name to patch"),
    })).describe("Extracted insights, empty array if nothing worth persisting"),
});

export class InsightExtractor implements IInsightExtractor {
    private logger?: ILogger;

    constructor(
        @inject(IModelService) private modelService: IModelService,
        @inject(T_InsightExtractorSystemPrompt) private systemPrompt: string,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
    ) {
        this.logger = loggerService?.getLogger("InsightExtractor");
    }

    async extract(userMessage: string, assistantMessages: string[], existingNames: string[]): Promise<ExtractedInsight[]> {
        try {
            const parts = assistantMessages?.filter(Boolean);
            let human = parts?.length
                ? `<user>${userMessage}</user>\n${parts.map(m => `<assistant>${m}</assistant>`).join("\n")}`
                : `<user>${userMessage}</user>`;

            if (existingNames.length > 0) {
                human += `\n<existing-insights>\n${existingNames.join("\n")}\n</existing-insights>`;
            }

            const messages: ChatMessage[] = [
                { role: MessageRole.System, content: this.systemPrompt },
                { role: MessageRole.Human, content: human },
            ];
            const { results } = await this.modelService.invokeStructured<{ results: ExtractedInsight[] }>(InsightExtractionSchema, messages);
            return results;
        } catch (error: any) {
            this.logger?.warn(`Insight extraction failed: ${error.message}`);
            return [];
        }
    }
}
