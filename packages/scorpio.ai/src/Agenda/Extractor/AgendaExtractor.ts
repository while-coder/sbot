import { z } from "zod";
import { inject } from "scorpio.di";
import { IModelService } from "../../Model";
import { ILoggerService, ILogger } from "../../Logger";
import { MessageRole, type ChatMessage } from "../../Saver";
import { renderConversation } from "../../Utils/conversationUtils";
import { TimeUtils } from "../../Utils/TimeUtils";
import { T_AgendaExtractorSystemPrompt, formatError } from "../../Core";
import {
    AgendaPriority,
    AgendaTimeUnit,
    AgendaTriggerAction,
    AgendaTriggerKind,
    type AgendaRecord,
} from "../types";
import { AgendaRenderMode, formatAgendaXml } from "../format";
import { EXISTING_AGENDA_LIMIT } from "../limits";
import { type AgendaAction, AgendaActionType, IAgendaExtractor } from "./IAgendaExtractor";

const RelativeTimeSchema = z.object({
    amount: z.number().int().positive(),
    unit: z.enum(AgendaTimeUnit),
});

const ActionSchema = z.enum(AgendaTriggerAction).optional().describe('Per-trigger delivery mode. notify (default), notify_and_record (also records the fire into the conversation history), invoke.');
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
});

const SetPatchSchema = z.object({
    content: z.string().optional(),
    priority: z.enum(AgendaPriority).optional(),
    dueAt: z.string().nullable().optional(),
}).describe('Item-level field changes. Omit when only the schedule changes.');

/**
 * op=patch 的载荷。kind 可选（只改 action / message 时不动 kind），所以不能用 discriminatedUnion；
 * 与 AgendaToolProvider 的 TriggerPatchSchema 同形，校验在 service.patchTrigger。
 */
const TriggerPatchSchema = z.object({
    kind: z.enum(AgendaTriggerKind).optional().describe('Only when switching trigger type; then the matching schedule field (at / every / expr) is mandatory.'),
    at: z.string().optional(),
    every: RelativeTimeSchema.optional(),
    expr: z.string().optional().describe('SIX-field cron.'),
    startAt: z.string().optional().describe('Explicitly reset the next fire instant (ISO).'),
    count: z.number().int().positive().optional(),
    action: ActionSchema,
    message: z.string().min(1).optional(),
}).describe('Only the fields to change; everything else keeps its current value AND its fire progress.');

const TriggerEditSchema = z.discriminatedUnion('op', [
    z.object({ op: z.literal('add'), spec: TriggerSpecSchema }),
    z.object({ op: z.literal('patch'), id: z.number().describe('trigger id from <existing-agenda>.'), patch: TriggerPatchSchema }),
    z.object({ op: z.literal('remove'), id: z.number().describe('trigger id from <existing-agenda>.') }),
]);

const AgendaExtractSchema = z.object({
    actions: z.array(z.discriminatedUnion("type", [
        z.object({ type: z.literal(AgendaActionType.Create), args: CreateArgsSchema }),
        z.object({
            type: z.literal(AgendaActionType.Edit),
            id: z.number().describe('agenda id from <existing-agenda>.'),
            set: SetPatchSchema.optional(),
            triggers: z.array(TriggerEditSchema).optional().describe('Trigger operations, applied in order. Put every related change into ONE edit action so content and schedule land together.'),
        }),
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
                // Sync 模式：message 要全文——抽取器靠原文判断措辞是否需要改写、是否与本轮重复。
                const body = existingItems.slice(0, EXISTING_AGENDA_LIMIT)
                    .map(r => formatAgendaXml(r, AgendaRenderMode.Sync))
                    .join('\n');
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
            this.logger?.warn(`Agenda extraction failed: ${formatError(error, true)}`);
            return [];
        }
    }
}
