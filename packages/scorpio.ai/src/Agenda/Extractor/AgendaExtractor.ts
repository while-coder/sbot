import { z } from "zod";
import { inject } from "scorpio.di";
import { IModelService } from "../../Model";
import { ILoggerService, ILogger } from "../../Logger";
import { MessageRole, type ChatMessage } from "../../Saver";
import { renderConversation } from "../../Utils/conversationUtils";
import { T_AgendaExtractorSystemPrompt } from "../../Core";
import {
    AgendaCategory,
    AgendaCompletionMode,
    AgendaPriority,
    AgendaTimeUnit,
    AgendaTriggerAction,
    AgendaTriggerKind,
    type AgendaRecord,
} from "../types";
import { type AgendaAction, AgendaActionType, IAgendaExtractor } from "./IAgendaExtractor";

const RelativeTimeSchema = z.object({
    amount: z.number(),
    unit: z.enum(AgendaTimeUnit),
});

const TriggerSpecSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal(AgendaTriggerKind.Absolute),
        at: z.string(),
    }),
    z.object({
        kind: z.literal(AgendaTriggerKind.Interval),
        every: RelativeTimeSchema,
        startAt: z.string().optional(),
        count: z.number().int().positive().optional(),
    }),
    z.object({
        kind: z.literal(AgendaTriggerKind.Cron),
        expr: z.string(),
        startAt: z.string().optional(),
        count: z.number().int().positive().optional(),
    }),
]);

const CreateArgsSchema = z.object({
    content: z.string(),
    category: z.enum(AgendaCategory).optional(),
    priority: z.enum(AgendaPriority).optional(),
    trigger: TriggerSpecSchema.optional(),
    dueAt: z.string().optional(),
    action: z.enum(AgendaTriggerAction).optional(),
    message: z.string().optional(),
    completionMode: z.enum(AgendaCompletionMode).optional(),
});

const UpdatePatchSchema = z.object({
    content: z.string().optional(),
    category: z.enum(AgendaCategory).optional(),
    priority: z.enum(AgendaPriority).optional(),
    completionMode: z.enum(AgendaCompletionMode).optional(),
    dueAt: z.string().nullable().optional(),
});

const AgendaExtractSchema = z.object({
    actions: z.array(z.discriminatedUnion("type", [
        z.object({ type: z.literal(AgendaActionType.Create), args: CreateArgsSchema }),
        z.object({ type: z.literal(AgendaActionType.Update), id: z.number(), patch: UpdatePatchSchema }),
        z.object({
            type: z.literal(AgendaActionType.Complete),
            id: z.number(),
            at: z.string().optional().describe('ISO datetime of the specific occurrence the user is completing. Use it when the user references a past time — including backfilling missed instances. Omit for plain "现在/just now" check-ins.'),
        }),
        z.object({ type: z.literal(AgendaActionType.Cancel), id: z.number() }),
    ])).describe("Agenda actions extracted from the conversation. Return [] if no agenda change is needed."),
});

export class AgendaExtractor implements IAgendaExtractor {
    private logger?: ILogger;

    constructor(
        @inject(IModelService) private modelService: IModelService,
        @inject(T_AgendaExtractorSystemPrompt) private systemPrompt: string,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
    ) {
        this.logger = loggerService?.getLogger("AgendaExtractor");
    }

    async extract(messages: ChatMessage[], existingItems: AgendaRecord[]): Promise<AgendaAction[]> {
        try {
            let human = renderConversation(messages);

            if (existingItems.length > 0) {
                const lines = existingItems.slice(0, 80).map(record => {
                    const item = record.item;
                    const next = record.triggers
                        .filter(t => t.enabled && t.nextFireAt)
                        .map(t => new Date(t.nextFireAt!).toISOString())
                        .sort()[0];
                    return `#${item.id} [${item.status}/${item.category}/${item.priority}/${item.completionMode}]${item.dueAt ? ` due=${new Date(item.dueAt).toISOString()}` : ''}${next ? ` next=${next}` : ''} ${item.content}`;
                });
                human += `\n<existing-agenda>\n${lines.join("\n")}\n</existing-agenda>`;
            }
            human += `\n<now>${new Date().toISOString()}</now>`;

            const llmMessages: ChatMessage[] = [
                { role: MessageRole.System, content: this.systemPrompt },
                { role: MessageRole.Human, content: human },
            ];
            const { actions } = await this.modelService.invokeStructured<{ actions: AgendaAction[] }>(
                AgendaExtractSchema,
                llmMessages,
            );
            return actions;
        } catch (error: any) {
            const detail = error?.response?.data ? ` body=${JSON.stringify(error.response.data)}` : '';
            this.logger?.warn(`Agenda extraction failed: ${error.message}${detail}`);
            return [];
        }
    }
}

