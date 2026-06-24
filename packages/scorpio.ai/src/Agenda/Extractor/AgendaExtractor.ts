import { z } from "zod";
import { inject } from "scorpio.di";
import { IModelService } from "../../Model";
import { ILoggerService, ILogger } from "../../Logger";
import { MessageRole, type ChatMessage } from "../../Saver";
import { renderConversation } from "../../Utils/conversationUtils";
import { TimeUtils } from "../../Utils/TimeUtils";
import { T_AgendaExtractorSystemPrompt } from "../../Core";
import {
    AgendaPriority,
    AgendaTimeUnit,
    AgendaTriggerAction,
    AgendaTriggerKind,
    type AgendaRecord,
} from "../types";
import { formatAgendaXml } from "../format";
import { EXISTING_AGENDA_LIMIT } from "../limits";
import { type AgendaAction, AgendaActionType, IAgendaExtractor } from "./IAgendaExtractor";

const RelativeTimeSchema = z.object({
    amount: z.number().int().positive(),
    unit: z.enum(AgendaTimeUnit),
});

const ActionSchema = z.enum(AgendaTriggerAction).optional().describe('Per-trigger delivery mode. notify (default), notify_and_record (REQUIRED for occurrence routines), invoke.');
const MessageSchema = z.string().min(1).describe('REQUIRED per-trigger fire-time text — the exact words delivered WHEN this trigger fires, phrased as a present-moment ping ("Time to drink water"), NOT as a request to set a reminder ("remind me to drink water in 2 min" ✗). No fallback to content; if there is no special wording, restate the content. Recorded fires re-enter the conversation, so request-like wording can make this very sync create a duplicate agenda.');

const TriggerSpecSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal(AgendaTriggerKind.Absolute),
        at: z.string().describe('ISO datetime of the single fire moment.'),
        action: ActionSchema,
        message: MessageSchema,
    }),
    z.object({
        kind: z.literal(AgendaTriggerKind.Interval),
        every: RelativeTimeSchema.describe('Repeat interval, e.g. {amount:1,unit:"day"} = every day; {amount:90,unit:"minute"} = every 90 minutes.'),
        startAt: z.string().optional(),
        count: z.number().int().positive().optional(),
        action: ActionSchema,
        message: MessageSchema,
    }),
    z.object({
        kind: z.literal(AgendaTriggerKind.Cron),
        expr: z.string().describe('SIX-field cron: "sec min hour dom month dow". NOT five-field.'),
        startAt: z.string().optional(),
        count: z.number().int().positive().optional(),
        action: ActionSchema,
        message: MessageSchema,
    }),
]);

const CreateArgsSchema = z.object({
    content: z.string().describe('Canonical, self-contained title. A clean noun-phrase or imperative ("Submit weekly report", "Drink water", "Build a web matching game (timer / levels / shuffle / hints)"); not a reply or a kickoff phrase like "Start by ...". Do NOT bake relative time or schedule into the title ("remind me to drink water in 2 min" ✗ → "Drink water"); timing belongs in triggers. Match the user\'s language. Note: each trigger carries its own required message — content is not the fire-time fallback.'),
    priority: z.enum(AgendaPriority).optional(),
    triggers: z.array(TriggerSpecSchema).optional().describe('Schedule list; each element carries its own action/message. Omit or [] for a plain todo with no time.'),
    dueAt: z.string().optional(),
    requiresCheckIn: z.boolean().optional(),
});

const UpdatePatchSchema = z.object({
    content: z.string().optional(),
    priority: z.enum(AgendaPriority).optional(),
    requiresCheckIn: z.boolean().optional(),
    dueAt: z.string().nullable().optional(),
});

const TriggerReplaceAllArgsSchema = z.object({
    triggers: z.array(TriggerSpecSchema).describe('Final active trigger list (each carries its own action/message). [] = clear all active triggers.'),
});

const AgendaExtractSchema = z.object({
    actions: z.array(z.discriminatedUnion("type", [
        z.object({ type: z.literal(AgendaActionType.Create), args: CreateArgsSchema }),
        z.object({ type: z.literal(AgendaActionType.Update), id: z.number(), patch: UpdatePatchSchema }),
        z.object({
            type: z.literal(AgendaActionType.Complete),
            id: z.number(),
            at: z.string().optional().describe('ISO datetime of the specific occurrence the user is completing. Use it when the user references a past time — including backfilling missed instances. Omit for a plain "just now" check-in.'),
        }),
        z.object({ type: z.literal(AgendaActionType.Cancel), id: z.number() }),
        z.object({ type: z.literal(AgendaActionType.TriggerAdd), itemId: z.number(), args: TriggerSpecSchema }),
        z.object({ type: z.literal(AgendaActionType.TriggerUpdate), triggerId: z.number(), patch: TriggerSpecSchema }),
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
                const body = existingItems.slice(0, EXISTING_AGENDA_LIMIT).map(formatAgendaXml).join('\n');
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
