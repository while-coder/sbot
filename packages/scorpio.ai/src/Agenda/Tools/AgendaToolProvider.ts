import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
    AgendaAssignee,
    AgendaCloseOutcome,
    AgendaPriority,
    AgendaStatus,
    AgendaTimeUnit,
    AgendaTriggerAction,
    AgendaTriggerKind,
    type AgendaCreateArgs,
    type AgendaEditArgs,
    type AgendaListFilter,
    type AgendaTriggerEdit,
} from "../types";
import { IAgendaService } from "../Service/IAgendaService";
import { AgendaRenderMode, formatAgendaXml } from "../format";
import { DEFAULT_LIST_LIMIT, DETAIL_FIRES_LIMIT } from "../limits";

export const AGENDA_CREATE_TOOL_NAME = 'agenda_create' as const;
export const AGENDA_LIST_TOOL_NAME = 'agenda_list' as const;
export const AGENDA_GET_TOOL_NAME = 'agenda_get' as const;
export const AGENDA_EDIT_TOOL_NAME = 'agenda_edit' as const;
export const AGENDA_CLOSE_TOOL_NAME = 'agenda_close' as const;
export const AGENDA_WIKI_TOOL_NAME = 'agenda_wiki' as const;

const AGENDA_WIKI_TOOL_DESCRIPTION = [
    'Agenda system decision rules / deep manual.',
    'Call when uncertain about any agenda operation — meaning, parameter choice, edge case, cross-tool sync.',
    'No parameters.',
].join('\n');

const RelativeTimeSchema = z.object({
    amount: z.number().int().positive(),
    unit: z.enum(AgendaTimeUnit).describe('minute / hour / day / week.'),
});

const ActionSchema = z.enum(AgendaTriggerAction).optional().describe([
    'What happens when this trigger fires:',
    '- notify (default) = plain-text reminder',
    '- notify_and_record = also records the fire into the conversation history',
    '- invoke = AI actively produces at fire time, e.g. "generate/summarize/write/organize for me"',
    'Details → agenda_wiki §7.',
].join('\n'));

const MESSAGE_DESC = [
    'Per-trigger fire-time text — the exact words delivered WHEN this trigger fires.',
    'Phrase it as a present-moment ping ("Time to drink water"), not a request to set one ("remind me to drink water in 2 min" ✗).',
    'No fallback to content; if there is no special wording, restate content.',
    'Recorded fires re-enter the conversation, so request-like wording can make the post-turn sync create a duplicate agenda.',
    'Keep it portable: name directories RELATIVE to the working directory ("under daily_games/"), never absolute.',
    'The workdir is per-session, so a baked-in path later writes into a stale directory and breaks delivered links (agenda_wiki §9).',
].join('\n');

const MessageSchema = z.string().min(1).describe(`REQUIRED. ${MESSAGE_DESC}`);

const AssigneeSchema = z.enum(AgendaAssignee).optional().describe([
    'Who owns this todo — decide EXPLICITLY:',
    '- user (default) = the user does it themselves',
    '- ai = you the AI do it, e.g. "you help me summarize/generate"',
    '- other = a third party like a colleague; put their name in assigneeName',
    'Orthogonal to trigger.action.',
].join('\n'));
const AssigneeNameSchema = z.string().optional().describe('Third-party name; only meaningful with assignee=other, ignored otherwise.');

const StartAtSchema = z.string().optional().describe('ISO of FIRST fire; omit for default.');
const CountSchema = z.number().int().positive().optional().describe('Total fire count; omit for unlimited.');

const CRON_EXPR_DESC = 'SIX-field cron: "sec min hour dom month dow" (NOT 5-field). Example: "0 0 9 * * 1-5" = 9am weekdays.';

const TriggerSpecSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal(AgendaTriggerKind.Absolute),
        at: z.string().describe('ISO datetime, e.g. "2026-09-19T09:00:00". Compute relative times yourself.'),
        action: ActionSchema,
        message: MessageSchema,
    }).describe('One-shot trigger.'),
    z.object({
        kind: z.literal(AgendaTriggerKind.Interval),
        every: RelativeTimeSchema.describe('Repeat interval, e.g. {amount:1,unit:"day"}.'),
        startAt: StartAtSchema,
        count: CountSchema,
        action: ActionSchema,
        message: MessageSchema,
    }).describe('Fixed-cadence recurrence.'),
    z.object({
        kind: z.literal(AgendaTriggerKind.Cron),
        expr: z.string().describe(CRON_EXPR_DESC),
        startAt: StartAtSchema,
        count: CountSchema,
        action: ActionSchema,
        message: MessageSchema,
    }).describe('Calendar-aligned recurrence.'),
]);

/**
 * op=patch 的载荷：全字段可选、只改传入的部分，fireCount / lastFiredAt 保留。
 *
 * 不能用 discriminatedUnion（kind 本身可选——大多数 patch 就是「只改 action / 只改 message」，
 * 不动 kind），所以 schedule 字段平铺 + 用 describe 说清 kind 与 at/every/expr 的配对约束，
 * 真正的校验在 AgendaService.patchTrigger 里做。
 */
const TriggerPatchSchema = z.object({
    kind: z.enum(AgendaTriggerKind).optional().describe([
        'Only when SWITCHING trigger type; you must then also pass the matching schedule field',
        '(absolute→at / interval→every / cron→expr), otherwise the call is rejected.',
        'Omit to keep the current type — most patches only touch action / message.',
    ].join('\n')),
    at: z.string().describe('New ISO instant; for kind=absolute.').optional(),
    every: RelativeTimeSchema.describe('New interval; for kind=interval.').optional(),
    expr: z.string().describe(`New cron expression; for kind=cron. ${CRON_EXPR_DESC}`).optional(),
    startAt: z.string().optional().describe('Explicitly reset the NEXT fire instant (ISO). Use alone to postpone one occurrence without touching the cadence.'),
    count: CountSchema,
    action: ActionSchema,
    message: z.string().min(1).optional().describe(`Rewrite the fire-time text. ${MESSAGE_DESC}`),
}).describe('Fields to change; anything omitted keeps its current value, and fire progress is preserved.');

const TriggerEditSchema = z.discriminatedUnion('op', [
    z.object({
        op: z.literal('add'),
        spec: TriggerSpecSchema.describe('Same shape as agenda_create.triggers[i].'),
    }).describe('Append a new trigger.'),
    z.object({
        op: z.literal('patch'),
        id: z.number().describe('Existing trigger id (from agenda_list / agenda_get / <existing-agenda> XML).'),
        patch: TriggerPatchSchema,
    }).describe('Partially change one trigger, keeping its fire progress.'),
    z.object({
        op: z.literal('remove'),
        id: z.number().describe('Existing trigger id.'),
    }).describe('Disable one trigger. To reschedule, prefer op=patch — remove+add loses fire progress.'),
]);

export class AgendaToolProvider {
    /**
     * channelSessionId 由调用方注入，会写到新建 trigger 的 channelSessionId。
     * admin 路径调用（背景任务、route handler）传 0。
     */
    static getTools(agendaService: IAgendaService, channelSessionId: number): DynamicStructuredTool[] {
        const descs = agendaService.getToolDescs();
        return [
            new DynamicStructuredTool({
                name: AGENDA_CREATE_TOOL_NAME,
                description: descs.create,
                schema: z.object({
                    content: z.string().describe([
                        'Self-contained title, match user language. Just the thing itself ("Drink water" / "Submit weekly report").',
                        'Do NOT bake in relative time or schedule ("remind me to drink water in 2 min" ✗) — timing lives in triggers.',
                    ].join('\n')),
                    priority: z.enum(AgendaPriority).optional().describe('Default normal. high = urgent; low = casual.'),
                    assignee: AssigneeSchema,
                    assigneeName: AssigneeNameSchema,
                    triggers: z.array(TriggerSpecSchema).optional().describe('Schedule list; omit / [] = plain todo.'),
                    dueAt: z.string().optional().describe('ISO deadline. Pure metadata — does NOT auto-create a trigger (agenda_wiki §3).'),
                }),
                func: async (args: AgendaCreateArgs) => {
                    try {
                        const result = await agendaService.create({ ...args, channelSessionId });
                        const item = result.item.item;
                        if (result.existed) {
                            // 命中去重也要回显：LLM 下一步很可能往这条上加 trigger / 改文案，
                            // 需要既有的 trigger id 与 nextFireAt，否则得再补一次 agenda_get。
                            // Compact 而非 Echo——这条是既有数据，message 不是本次传的参数，预览有信息量。
                            return [
                                `Agenda #${item.id} already exists: ${item.content}`,
                                `No new agenda item was created. Its current schedule:`,
                                ``,
                                formatAgendaXml(result.item, AgendaRenderMode.Compact),
                            ].join('\n');
                        }
                        // 直接渲染刚创建的这条（含 trigger id），不要用全局 list+limit:1——
                        // 那会按排序返回"最靠前"的一条，未必是新建的这条。
                        // Echo：message 是本次调用自己刚传的参数，回显纯属复读；要的是 trigger id + nextFireAt。
                        return `Created agenda #${item.id}: ${item.content}\n\n${formatAgendaXml(result.item, AgendaRenderMode.Echo)}`;
                    } catch (e: any) {
                        return `Failed to create agenda item: ${e.message}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: AGENDA_LIST_TOOL_NAME,
                description: descs.list,
                schema: z.object({
                    status: z.enum([AgendaStatus.Pending, AgendaStatus.Done, AgendaStatus.Cancelled, AgendaStatus.Expired, 'all']).optional().describe('Default pending. "all" = no filter.'),
                    priority: z.enum(AgendaPriority).optional(),
                    assignee: z.enum(AgendaAssignee).optional().describe([
                        'Filter by owner: user = the user\'s own todos / ai = ones assigned to you / other = third-party.',
                        'Use to answer "how many do I / do you have left".',
                    ].join('\n')),
                    limit: z.number().int().positive().optional().describe(`Default ${DEFAULT_LIST_LIMIT}.`),
                }),
                func: async (filter: AgendaListFilter) => {
                    try {
                        return await agendaService.formatForLLM(filter);
                    } catch (e: any) {
                        return `Failed to list agenda: ${e.message}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: AGENDA_GET_TOOL_NAME,
                description: descs.get,
                schema: z.object({
                    id: z.number().describe('Item id from agenda_list.'),
                    fires: z.boolean().optional().describe([
                        `Also return the last ${DETAIL_FIRES_LIMIT} fire records (when, which trigger, delivered or why not).`,
                        'Use it to answer "did it actually run / did the last one go through"; skip it otherwise.',
                    ].join('\n')),
                }),
                func: async ({ id, fires }: { id: number; fires?: boolean }) => {
                    try {
                        return await agendaService.formatDetailForLLM(id, { fires });
                    } catch (e: any) {
                        return `Failed to read agenda #${id}: ${e.message}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: AGENDA_EDIT_TOOL_NAME,
                description: descs.edit,
                schema: z.object({
                    id: z.number().describe('Item id.'),
                    set: z.object({
                        content: z.string().optional(),
                        priority: z.enum(AgendaPriority).optional(),
                        assignee: AssigneeSchema,
                        assigneeName: z.string().nullable().optional().describe('Third-party name (null clears). Auto-cleared when assignee is set to non-other.'),
                        dueAt: z.string().nullable().optional().describe('ISO or null. Does NOT retime triggers (agenda_wiki §3).'),
                    }).optional().describe('Item-level field changes; omit if only the schedule changes.'),
                    triggers: z.array(TriggerEditSchema).optional().describe([
                        'Trigger operations, applied in order. Omit if only item fields change.',
                        'Put every related change in ONE call — content and schedule stay consistent, or nothing lands.',
                    ].join('\n')),
                }),
                func: async ({ id, ...args }: { id: number } & AgendaEditArgs) => {
                    try {
                        const record = await agendaService.edit(id, {
                            ...args,
                            triggers: args.triggers as AgendaTriggerEdit[] | undefined,
                            channelSessionId,
                        });
                        if (!record) return `Agenda #${id} not found.`;
                        // Compact：本次没碰到的 trigger 也在回显里，只给 message 预览足够区分是哪条。
                        return `Updated agenda #${record.item.id}: ${record.item.content}\n\n${formatAgendaXml(record, AgendaRenderMode.Compact)}`;
                    } catch (e: any) {
                        return `Failed to edit agenda #${id}: ${e.message}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: AGENDA_CLOSE_TOOL_NAME,
                description: descs.close,
                schema: z.object({
                    id: z.number().describe('Item id.'),
                    outcome: z.enum(AgendaCloseOutcome).describe([
                        '- done = finished it',
                        '- dropped = no longer wanted / "stop reminding me"',
                        'Both stop ALL triggers on the item permanently. For a recurring routine, one occurrence being done',
                        'is NOT a reason to close — that would kill the whole routine (agenda_wiki §6).',
                    ].join('\n')),
                    at: z.string().optional().describe('ISO instant it was actually finished, if not now (outcome=done only).'),
                }),
                func: async ({ id, outcome, at }: { id: number; outcome: AgendaCloseOutcome; at?: string }) => {
                    try {
                        const record = await agendaService.close(id, outcome, at);
                        if (!record) return `Agenda #${id} not found.`;
                        return `Closed agenda #${record.item.id} as ${record.item.status}: ${record.item.content}`;
                    } catch (e: any) {
                        return `Failed to close agenda #${id}: ${e.message}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: AGENDA_WIKI_TOOL_NAME,
                description: AGENDA_WIKI_TOOL_DESCRIPTION,
                schema: z.object({}),
                func: async () => descs.wiki,
            }),
        ];
    }
}
