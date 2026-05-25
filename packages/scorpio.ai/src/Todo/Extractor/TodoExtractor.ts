import { z } from "zod";
import { inject } from "scorpio.di";
import { IModelService } from "../../Model";
import { MessageRole, type ChatMessage } from "../../Saver";
import { ILoggerService, ILogger } from "../../Logger";
import { T_TodoExtractorSystemPrompt } from "../../Core";
import { type Todo, TodoPriority } from "../ITodoService";
import { ITodoExtractor, TodoAction } from "./ITodoExtractor";

const TodoExtractionSchema = z.object({
    actions: z.array(z.object({
        action: z.enum(['create', 'patch', 'done', 'delete']).describe("CRUD action type"),
        id: z.number().optional().describe("Existing todo id (required for patch/done/delete)"),
        content: z.string().optional().describe("Task description (required for create, optional for patch)"),
        priority: z.enum(TodoPriority).optional().describe("Priority level"),
        deadline: z.string().optional().describe("ISO 8601 datetime, e.g. 2026-05-29T18:00:00"),
    })).describe("Todo CRUD actions extracted from the conversation, empty array if nothing to do"),
});

export class TodoExtractor implements ITodoExtractor {
    private logger?: ILogger;

    constructor(
        @inject(IModelService) private modelService: IModelService,
        @inject(T_TodoExtractorSystemPrompt) private systemPrompt: string,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
    ) {
        this.logger = loggerService?.getLogger("TodoExtractor");
    }

    async extract(userMessage: string, assistantMessages: string[], existingTodos: Todo[]): Promise<TodoAction[]> {
        try {
            const parts = assistantMessages?.filter(Boolean);
            let human = parts?.length
                ? `<user>${userMessage}</user>\n${parts.map(m => `<assistant>${m}</assistant>`).join("\n")}`
                : `<user>${userMessage}</user>`;

            if (existingTodos.length > 0) {
                const lines = existingTodos.map(t => {
                    const dl = t.deadline ? ` due=${t.deadline}` : '';
                    return `#${t.id} [${t.status}/${t.priority}]${dl} ${t.content}`;
                });
                human += `\n<existing-todos>\n${lines.join("\n")}\n</existing-todos>`;
            }
            human += `\n<now>${new Date().toISOString()}</now>`;

            const messages: ChatMessage[] = [
                { role: MessageRole.System, content: this.systemPrompt },
                { role: MessageRole.Human, content: human },
            ];
            const { actions } = await this.modelService.invokeStructured<{ actions: TodoAction[] }>(
                TodoExtractionSchema,
                messages,
            );
            return actions;
        } catch (error: any) {
            this.logger?.warn(`Todo extraction failed: ${error.message}`);
            return [];
        }
    }
}
