import { z } from "zod";
import { inject } from "scorpio.di";
import { IModelService } from "../../Model";
import { ILoggerService, ILogger } from "../../Logger";
import { MessageRole, type ChatMessage } from "../../Saver";
import { renderConversation } from "../../Utils/conversationUtils";
import { TimeUtils } from "../../Utils/TimeUtils";
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
import { formatAgendaXml } from "../format";
import { type AgendaAction, AgendaActionType, IAgendaExtractor } from "./IAgendaExtractor";

const RelativeTimeSchema = z.object({
    amount: z.number().int().positive(),
    unit: z.enum(AgendaTimeUnit),
});

const TriggerSpecSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal(AgendaTriggerKind.Absolute),
        at: z.string().describe('ISO datetime of the single fire moment.'),
    }),
    z.object({
        kind: z.literal(AgendaTriggerKind.Interval),
        every: RelativeTimeSchema.describe('Repeat interval, e.g. {amount:1,unit:"day"} = every day; {amount:90,unit:"minute"} = every 90 minutes.'),
        startAt: z.string().optional(),
        count: z.number().int().positive().optional(),
    }),
    z.object({
        kind: z.literal(AgendaTriggerKind.Cron),
        expr: z.string().describe('SIX-field cron: "sec min hour dom month dow". NOT five-field.'),
        startAt: z.string().optional(),
        count: z.number().int().positive().optional(),
    }),
]);

const CreateArgsSchema = z.object({
    content: z.string().describe('Canonical, self-contained description used as the default fire-time text. A clean noun-phrase or imperative title ("Submit weekly report", "喝水", "Build a web matching game (timer / levels / shuffle / hints)"); not a reply or a kickoff phrase like "Start by ...". Match the user\'s language.'),
    category: z.enum(AgendaCategory).optional(),
    priority: z.enum(AgendaPriority).optional(),
    triggers: z.array(TriggerSpecSchema).optional().describe('Schedule list. Omit or [] for a plain todo with no time. One element for a single schedule; multiple elements for several active schedules on the same item.'),
    dueAt: z.string().optional(),
    action: z.enum(AgendaTriggerAction).optional(),
    message: z.string().optional().describe('OPTIONAL override of the fire-time text. Default = content (omit this field). Only set when fire-time text needs to differ from content — e.g. friendlier reminder tone for notify ("Time to submit your weekly report!"), or a fuller invoke instruction when content alone is too terse. Do NOT restate or paraphrase content; if you would just rewrite the same idea, omit.'),
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
                const body = existingItems.slice(0, 80).map(formatAgendaXml).join('\n');
                human += `\n<existing-agenda>\n${body}\n</existing-agenda>`;
            }
            human += `\n<now>${TimeUtils.formatIsoMinute(Date.now())}</now>`;

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
