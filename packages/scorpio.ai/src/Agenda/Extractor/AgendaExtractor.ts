import { z } from "zod";
import { inject } from "scorpio.di";
import { IModelService } from "../../Model";
import { ILoggerService, ILogger } from "../../Logger";
import { MessageRole, type ChatMessage } from "../../Saver";
import { renderConversation } from "../../Utils/conversationUtils";
import { TimeUtils } from "../../Utils/TimeUtils";
import { T_AgendaExtractorSystemPrompt, T_AgendaSelectorSystemPrompt, formatError } from "../../Core";
import {
    AgendaPriority,
    AgendaTimeUnit,
    AgendaTriggerAction,
    AgendaTriggerKind,
    type AgendaRecord,
} from "../types";
import { AgendaRenderMode, formatAgendaXml } from "../format";
import { type AgendaAction, AgendaActionType, IAgendaExtractor } from "./IAgendaExtractor";

const DEFAULT_AGENDA_CONTEXT_WINDOW = 32_000;
const AGENDA_SYNC_INPUT_TOKEN_CAP = 16_000;
const AGENDA_INTENT_LIMIT = 12;
const AGENDA_CANDIDATES_PER_BATCH = 8;
const AGENDA_FINAL_CANDIDATE_LIMIT = 20;

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

const AgendaIntentSchema = z.string().min(1).max(400);
const AgendaIntentAnalysisSchema = z.discriminatedUnion('shouldSync', [
    z.object({
        shouldSync: z.literal(false),
        intents: z.array(AgendaIntentSchema).max(0),
    }),
    z.object({
        shouldSync: z.literal(true),
        intents: z.array(AgendaIntentSchema).min(1).max(AGENDA_INTENT_LIMIT),
    }),
]);
type AgendaIntentAnalysis = z.infer<typeof AgendaIntentAnalysisSchema>;

const AgendaCandidateOutputSchema = z.object({
    ids: z.array(z.number().int().positive()).max(AGENDA_FINAL_CANDIDATE_LIMIT),
});
type AgendaCandidateOutput = z.infer<typeof AgendaCandidateOutputSchema>;

export class AgendaExtractor implements IAgendaExtractor {
    private logger?: ILogger;

    constructor(
        @inject(IModelService) private modelService: IModelService,
        @inject(T_AgendaExtractorSystemPrompt) private systemPrompt: string,
        @inject(T_AgendaSelectorSystemPrompt) private selectorPrompt: string,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
    ) {
        this.logger = loggerService?.getLogger("AgendaExtractor");
    }

    async extract(messages: ChatMessage[], existingItems: AgendaRecord[]): Promise<AgendaAction[]> {
        try {
            const conversation = renderConversation(messages);
            const now = TimeUtils.formatIsoMinute(Date.now());
            const inputBudget = this.inputTokenBudget();
            const directMessages = this.buildExtractionMessages(
                conversation,
                existingItems,
                AgendaRenderMode.Sync,
                now,
            );
            const directTokens = AgendaExtractor.estimateMessagesTokens(directMessages);

            // 常规路径保持一次模型调用：完整对话 + 全部 Pending Agenda 完整结构。
            if (directTokens <= inputBudget) {
                this.logger?.debug(`AgendaSync single pass: items=${existingItems.length}, estimatedInput=${directTokens}, budget=${inputBudget}`);
                return this.invokeActions(directMessages, existingItems);
            }

            // 只有输入超预算才进入降级路径。完整对话只分析一次；后续批次只重复短 intents。
            this.logger?.debug(`AgendaSync input over budget, switching to candidate batches: items=${existingItems.length}, estimatedInput=${directTokens}, budget=${inputBudget}`);
            const analysis = await this.analyzeConversation(conversation, now);
            if (!analysis.shouldSync) return [];

            let candidates = existingItems.length === 0
                ? []
                : await this.selectCandidates(
                    analysis.intents,
                    existingItems,
                    now,
                    inputBudget,
                    AGENDA_CANDIDATES_PER_BATCH,
                );
            while (candidates.length > AGENDA_FINAL_CANDIDATE_LIMIT) {
                const reduced = await this.selectCandidates(
                    analysis.intents,
                    candidates,
                    now,
                    inputBudget,
                    AGENDA_FINAL_CANDIDATE_LIMIT,
                );
                if (reduced.length === 0 || reduced.length >= candidates.length) {
                    candidates = candidates.slice(0, AGENDA_FINAL_CANDIDATE_LIMIT);
                    break;
                }
                candidates = reduced;
            }

            const selected = candidates.slice(0, AGENDA_FINAL_CANDIDATE_LIMIT);
            let finalMessages = this.buildExtractionMessages(
                conversation,
                selected,
                AgendaRenderMode.Sync,
                now,
                true,
            );
            if (AgendaExtractor.estimateMessagesTokens(finalMessages) > inputBudget) {
                // 极长 invoke message 可能让少量候选仍超预算。Compact 仍保留 item/trigger id、
                // schedule、action 与 message preview，Edit 的未提供字段由 service 原样保留。
                this.logger?.warn(`AgendaSync selected full records still exceed budget; using message previews for ${selected.length} candidate(s)`);
                finalMessages = this.buildExtractionMessages(
                    conversation,
                    selected,
                    AgendaRenderMode.Compact,
                    now,
                    true,
                );
            }
            return this.invokeActions(finalMessages, selected);
        } catch (error: any) {
            this.logger?.warn(`Agenda extraction failed: ${formatError(error, true)}`);
            return [];
        }
    }

    private async invokeActions(messages: ChatMessage[], visibleItems: AgendaRecord[]): Promise<AgendaAction[]> {
        const { actions } = await this.modelService.invokeStructured<{ actions: AgendaAction[] }>(
            AgendaExtractSchema,
            messages,
        );
        const visibleIds = new Set(visibleItems.map(record => record.item.id));
        return actions.filter(action => {
            if (action.type === AgendaActionType.Create || visibleIds.has(action.id)) return true;
            this.logger?.warn(`AgendaSync ignored Edit for an item not shown to the final extractor: #${action.id}`);
            return false;
        });
    }

    private async analyzeConversation(conversation: string, now: string): Promise<AgendaIntentAnalysis> {
        const messages: ChatMessage[] = [
            {
                role: MessageRole.System,
                content: [
                    this.selectorPrompt,
                    `# Conversation analysis mode`,
                    `Return shouldSync=true only for explicit agenda changes that may still need background application.`,
                    `When true, return up to ${AGENDA_INTENT_LIMIT} short, self-contained intents retaining exact time, recurrence, target wording, and whether it is a create or edit.`,
                ].join('\n\n'),
            },
            {
                role: MessageRole.Human,
                content: `${conversation}\n<now>${now}</now>`,
            },
        ];
        return this.modelService.invokeStructured<AgendaIntentAnalysis>(AgendaIntentAnalysisSchema, messages);
    }

    private async selectCandidates(
        intents: string[],
        records: AgendaRecord[],
        now: string,
        inputBudget: number,
        maxCandidates: number,
    ): Promise<AgendaRecord[]> {
        const selected = new Map<number, AgendaRecord>();
        const chunks = this.chunkCards(intents, records, now, inputBudget, maxCandidates);
        this.logger?.debug(`AgendaSync candidate scan: items=${records.length}, batches=${chunks.length}, maxPerBatch=${maxCandidates}`);
        for (const chunk of chunks) {
            const messages = this.buildCandidateMessages(intents, chunk, now, maxCandidates);
            const result = await this.modelService.invokeStructured<AgendaCandidateOutput>(
                AgendaCandidateOutputSchema,
                messages,
            );
            const available = new Map(chunk.map(record => [record.item.id, record] as const));
            for (const id of result.ids.slice(0, maxCandidates)) {
                const record = available.get(id);
                if (record) selected.set(id, record);
                else this.logger?.warn(`Agenda selector returned an id outside the current batch: #${id}`);
            }
        }
        return [...selected.values()];
    }

    private buildExtractionMessages(
        conversation: string,
        existingItems: AgendaRecord[],
        mode: AgendaRenderMode.Sync | AgendaRenderMode.Compact,
        now: string,
        candidateSubset = false,
    ): ChatMessage[] {
        let human = conversation;
        if (existingItems.length > 0) {
            human += `\n<existing-agenda>\n${AgendaExtractor.renderRecords(existingItems, mode)}\n</existing-agenda>`;
        }
        human += `\n<now>${now}</now>`;
        return [
            {
                role: MessageRole.System,
                content: candidateSubset
                    ? [
                        this.systemPrompt,
                        `# Oversized-catalog candidate contract`,
                        `A prior pass screened the complete pending agenda catalog. <existing-agenda> contains only likely matches.`,
                        `Edit only IDs shown there. If none matches an explicit new request, Create is allowed.`,
                    ].join('\n\n')
                    : this.systemPrompt,
            },
            { role: MessageRole.Human, content: human },
        ];
    }

    private buildCandidateMessages(
        intents: string[],
        records: AgendaRecord[],
        now: string,
        maxCandidates: number,
    ): ChatMessage[] {
        return [
            {
                role: MessageRole.System,
                content: [
                    this.selectorPrompt,
                    `# Agenda-card matching mode`,
                    `Match the confirmed intents against this exact batch of compact agenda cards.`,
                    `Return up to ${maxCandidates} existing item IDs, ordered from most to least relevant.`,
                    `Do not propose Create/Edit actions and do not return IDs outside this batch.`,
                ].join('\n\n'),
            },
            {
                role: MessageRole.Human,
                content: [
                    `<agenda-intents>`,
                    intents.map(intent => `- ${intent}`).join('\n'),
                    `</agenda-intents>`,
                    `<agenda-cards>`,
                    AgendaExtractor.renderRecords(records, AgendaRenderMode.Compact),
                    `</agenda-cards>`,
                    `<now>${now}</now>`,
                ].join('\n'),
            },
        ];
    }

    private chunkCards(
        intents: string[],
        records: AgendaRecord[],
        now: string,
        inputBudget: number,
        maxCandidates: number,
    ): AgendaRecord[][] {
        if (records.length === 0) return [];
        const emptyMessages = this.buildCandidateMessages(intents, [], now, maxCandidates);
        const cardBudget = Math.max(256, inputBudget - AgendaExtractor.estimateMessagesTokens(emptyMessages));
        const chunks: AgendaRecord[][] = [];
        let current: AgendaRecord[] = [];
        let currentTokens = 0;
        for (const record of records) {
            const recordTokens = AgendaExtractor.estimateTextTokens(
                formatAgendaXml(record, AgendaRenderMode.Compact),
            );
            if (current.length > 0 && currentTokens + recordTokens > cardBudget) {
                chunks.push(current);
                current = [];
                currentTokens = 0;
            }
            current.push(record);
            currentTokens += recordTokens;
        }
        if (current.length > 0) chunks.push(current);
        return chunks;
    }

    private inputTokenBudget(): number {
        const contextWindow = this.modelService.config.contextWindow ?? DEFAULT_AGENDA_CONTEXT_WINDOW;
        return Math.max(512, Math.min(AGENDA_SYNC_INPUT_TOKEN_CAP, Math.floor(contextWindow * 0.5)));
    }

    private static renderRecords(records: AgendaRecord[], mode: AgendaRenderMode): string {
        return records.map(record => formatAgendaXml(record, mode)).join('\n');
    }

    private static estimateTextTokens(text: string): number {
        return Math.ceil(text.length * 0.75) + 4;
    }

    private static estimateMessagesTokens(messages: ChatMessage[]): number {
        return messages.reduce((sum, message) => {
            const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content);
            return sum + AgendaExtractor.estimateTextTokens(content);
        }, 0);
    }
}
