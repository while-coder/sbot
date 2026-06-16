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
    content: z.string().describe('Canonical, self-contained description of the agenda — used as the default fire-time text. Write this so it stands alone without context (a clean noun-phrase or imperative title, e.g. "Submit weekly report", "Build a web matching game (timer / levels / shuffle / hints)"), not as a reply or a kickoff phrase like "Start by ...".'),
    category: z.enum(AgendaCategory).optional(),
    priority: z.enum(AgendaPriority).optional(),
    trigger: TriggerSpecSchema.optional(),
    triggers: z.array(TriggerSpecSchema).optional().describe('Multiple active schedules for the same item. Use this instead of trigger when the item should fire at several times.'),
    dueAt: z.string().optional(),
    action: z.enum(AgendaTriggerAction).optional(),
    message: z.string().optional().describe('OPTIONAL override of the fire-time text. Default = content (omit this field). Only set when the fire-time text genuinely needs to differ from content — e.g. a friendlier reminder tone for notify ("Time to submit your weekly report!"), or a fuller instruction for invoke when content alone is too terse to act on. Do NOT restate or paraphrase content; if you would just rewrite the same idea, omit this field.'),
    completionMode: z.enum(AgendaCompletionMode).optional(),
});

const UpdatePatchSchema = z.object({
    content: z.string().optional(),
    category: z.enum(AgendaCategory).optional(),
    priority: z.enum(AgendaPriority).optional(),
    completionMode: z.enum(AgendaCompletionMode).optional(),
    dueAt: z.string().nullable().optional(),
});

const TriggerCreateArgsSchema = z.object({
    trigger: TriggerSpecSchema,
    action: z.enum(AgendaTriggerAction).optional(),
    message: z.string().nullable().optional(),
});

const TriggerUpdatePatchSchema = z.object({
    trigger: TriggerSpecSchema.optional(),
    action: z.enum(AgendaTriggerAction).optional(),
    message: z.string().nullable().optional().describe('Update the fire-time text. Use null to clear the override and fall back to content. Omit when unchanged.'),
});

const TriggerReplaceAllArgsSchema = z.object({
    triggers: z.array(TriggerSpecSchema).describe('Final active trigger list. Use [] to clear all active triggers.'),
    action: z.enum(AgendaTriggerAction).optional(),
    message: z.string().nullable().optional(),
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
        z.object({ type: z.literal(AgendaActionType.TriggerAdd), itemId: z.number(), args: TriggerCreateArgsSchema }),
        z.object({ type: z.literal(AgendaActionType.TriggerUpdate), triggerId: z.number(), patch: TriggerUpdatePatchSchema }),
        z.object({ type: z.literal(AgendaActionType.TriggerRemove), triggerId: z.number() }),
        z.object({ type: z.literal(AgendaActionType.TriggerReplaceAll), itemId: z.number(), args: TriggerReplaceAllArgsSchema }),
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
