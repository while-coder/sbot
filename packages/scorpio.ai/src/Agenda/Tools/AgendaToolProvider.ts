import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
    AgendaCategory,
    AgendaCompletionMode,
    AgendaPriority,
    AgendaStatus,
    AgendaTimeUnit,
    AgendaTriggerAction,
    AgendaTriggerKind,
    type AgendaCreateArgs,
    type AgendaListFilter,
    type AgendaTriggerCreateArgs,
    type AgendaTriggerReplaceAllArgs,
    type AgendaTriggerUpdatePatch,
    type AgendaUpdatePatch,
} from "../types";
import { IAgendaService } from "../Service/IAgendaService";

export const AGENDA_CREATE_TOOL_NAME = 'agenda_create' as const;
export const AGENDA_LIST_TOOL_NAME = 'agenda_list' as const;
export const AGENDA_UPDATE_TOOL_NAME = 'agenda_update' as const;
export const AGENDA_TRIGGER_ADD_TOOL_NAME = 'agenda_trigger_add' as const;
export const AGENDA_TRIGGER_UPDATE_TOOL_NAME = 'agenda_trigger_update' as const;
export const AGENDA_TRIGGER_REMOVE_TOOL_NAME = 'agenda_trigger_remove' as const;
export const AGENDA_TRIGGER_REPLACE_ALL_TOOL_NAME = 'agenda_trigger_replace_all' as const;
export const AGENDA_COMPLETE_TOOL_NAME = 'agenda_complete' as const;
export const AGENDA_CANCEL_TOOL_NAME = 'agenda_cancel' as const;

const RelativeTimeSchema = z.object({
    amount: z.number().int().positive().describe('Positive integer amount.'),
    unit: z.enum(AgendaTimeUnit).describe('Time unit: minute / hour / day / week.'),
});

const TriggerSpecSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal(AgendaTriggerKind.Absolute),
        at: z.string().describe('ISO datetime when the trigger fires once, e.g. "2026-09-19T09:00:00". For "1 hour from now" / "100 days later", compute the ISO yourself from the current time.'),
    }).describe('One-shot at a specific moment.'),
    z.object({
        kind: z.literal(AgendaTriggerKind.Interval),
        every: RelativeTimeSchema.describe('Repeat interval. Examples: {amount:1,unit:"day"} = every day; {amount:90,unit:"minute"} = every 90 minutes.'),
        startAt: z.string().optional().describe('ISO datetime of the FIRST fire. Omit to fire one interval from now.'),
        count: z.number().int().positive().optional().describe('Total fire count before stopping. Omit for unlimited.'),
    }).describe('Fixed-cadence recurrence. Use this for "每天", "每 90 分钟" style requests; do NOT escalate to cron unless calendar alignment is required.'),
    z.object({
        kind: z.literal(AgendaTriggerKind.Cron),
        expr: z.string().describe('SIX-field cron expression: "sec min hour dom month dow". NOT five-field. Examples: "0 0 9 * * 1-5" = 9am on weekdays; "0 0 9 1 * *" = 9am on the 1st of every month.'),
        startAt: z.string().optional().describe('ISO datetime of the FIRST fire. Omit for the next cron match from now.'),
        count: z.number().int().positive().optional().describe('Total fire count before stopping. Omit for unlimited.'),
    }).describe('Calendar-aligned recurrence. Use only when interval cannot express it (e.g. "工作日 9 点", "每月 1 号").'),
]);

export class AgendaToolProvider {
    /**
     * channelSessionId 由调用方注入，会写到新建 trigger 的 channelHint。
     * admin 路径调用（背景任务、route handler）传 0。
     */
    static getTools(agendaService: IAgendaService, channelSessionId: number): DynamicStructuredTool[] {
        const descs = agendaService.getToolDescs();
        return [
            new DynamicStructuredTool({
                name: AGENDA_CREATE_TOOL_NAME,
                description: descs.create,
                schema: z.object({
                    content: z.string().describe('Canonical, self-contained title used as the default fire-time text. A clean noun-phrase or imperative ("喝水", "Submit weekly report"); not a reply or a kickoff sentence. Match the user\'s language.'),
                    category: z.enum(AgendaCategory).optional().describe('Usually omit — system infers from triggers (interval/cron→routine, absolute→reminder, none→todo). Only set to override.'),
                    priority: z.enum(AgendaPriority).optional().describe('Default normal. high for "重要 / 紧急", low for "顺手".'),
                    triggers: z.array(TriggerSpecSchema).optional().describe('Schedule list. Omit or [] for a plain todo with no time. One element for a single schedule; multiple elements for several active schedules on the same item (e.g. "remind one day before AND at the deadline", "9:00 and 18:00").'),
                    dueAt: z.string().optional().describe('Explicit ISO deadline. Mainly for plain todos ("finish weekly report by Friday" → "2026-06-13T23:59:59"). When set without `triggers`, the system auto-fires a one-shot reminder at this moment so the deadline cannot pass silently. For reminder/routine the deadline is auto-derived from triggers; only set this to override.'),
                    action: z.enum(AgendaTriggerAction).optional().describe('How fires are delivered. notify (default) = pure text ping to the user; the fire is NOT recorded in conversation history — best for one-shot reminders / external pings where no contextual reply is expected. notify_and_record = same delivery, but ALSO writes the fire as an AI message into history so the main agent reads "[AI: 要喝水了][user: 已喝]" coherently — REQUIRED for occurrence routines (打卡/汇报/喝水/周报). invoke = feed the text to the AI agent as user input so it actively responds — use only when the user wants AI work at fire time, e.g. "每天 8 点帮我总结日志".'),
                    message: z.string().optional().describe('OPTIONAL override of the fire-time text. Defaults to `content` when omitted. Only set when fire-time text needs to differ from content — e.g. friendlier reminder tone ("Time to submit your weekly report!"), or a fuller invoke instruction when content is too terse (content="分析昨日日志" → message="请分析昨天的 nginx 日志，找出 5xx 异常并给出简报"). Do NOT paraphrase content; if you would just restate it, omit.'),
                    completionMode: z.enum(AgendaCompletionMode).optional().describe('Usually omit — system infers (todo→item, others→none). Set occurrence for routines where each fire is a separate instance the user must check off; pair it with action=notify_and_record.'),
                }),
                func: async (args: AgendaCreateArgs) => {
                    try {
                        const result = await agendaService.create({ ...args, channelSessionId });
                        const item = result.item.item;
                        if (result.existed) {
                            return `Agenda #${item.id} already exists: ${item.content}\nNo new agenda item was created.`;
                        }
                        return `Created agenda #${item.id}: ${item.content}\n\n${await agendaService.formatForLLM({ status: 'all', limit: 1 })}`;
                    } catch (e: any) {
                        return `Failed to create agenda item: ${e.message}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: AGENDA_LIST_TOOL_NAME,
                description: descs.list,
                schema: z.object({
                    status: z.enum([AgendaStatus.Pending, AgendaStatus.Done, AgendaStatus.Cancelled, 'all']).optional().describe('Status filter. Default = pending. "all" = no status filter.'),
                    category: z.enum(AgendaCategory).optional().describe('Filter by category: todo / reminder / routine.'),
                    priority: z.enum(AgendaPriority).optional().describe('Filter by priority: low / normal / high.'),
                    limit: z.number().optional().describe('Max items to return. Default 50.'),
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
                name: AGENDA_UPDATE_TOOL_NAME,
                description: descs.update,
                schema: z.object({
                    id: z.number().describe('Agenda item id (the #N in the list).'),
                    content: z.string().optional(),
                    category: z.enum(AgendaCategory).optional(),
                    priority: z.enum(AgendaPriority).optional(),
                    completionMode: z.enum(AgendaCompletionMode).optional(),
                    dueAt: z.string().nullable().optional().describe('ISO datetime, or null to clear. Does NOT auto-adjust existing triggers — see tool description.'),
                }),
                func: async ({ id, ...patch }: { id: number } & AgendaUpdatePatch) => {
                    try {
                        const record = await agendaService.update(id, { ...patch, channelSessionId });
                        return record ? `Updated agenda #${record.item.id}: ${record.item.content}` : `Agenda #${id} not found.`;
                    } catch (e: any) {
                        return `Failed to update agenda #${id}: ${e.message}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: AGENDA_TRIGGER_ADD_TOOL_NAME,
                description: descs.triggerAdd,
                schema: z.object({
                    itemId: z.number().describe('Existing agenda item id.'),
                    trigger: TriggerSpecSchema.describe('New active trigger to append.'),
                    action: z.enum(AgendaTriggerAction).optional().describe('Delivery mode for THIS new trigger. Defaults to notify.'),
                    message: z.string().nullable().optional().describe('Per-fire text override for this new trigger. null/omit = fall back to item.content.'),
                }),
                func: async ({ itemId, ...args }: { itemId: number } & AgendaTriggerCreateArgs) => {
                    try {
                        const record = await agendaService.addTrigger(itemId, { ...args, channelSessionId });
                        return record ? `Added trigger to agenda #${record.item.id}: ${record.item.content}` : `Agenda #${itemId} not found.`;
                    } catch (e: any) {
                        return `Failed to add trigger to agenda #${itemId}: ${e.message}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: AGENDA_TRIGGER_UPDATE_TOOL_NAME,
                description: descs.triggerUpdate,
                schema: z.object({
                    triggerId: z.number().describe('Id of the existing trigger to update.'),
                    trigger: TriggerSpecSchema.optional().describe('Replacement schedule. Omit to keep the current schedule.'),
                    action: z.enum(AgendaTriggerAction).optional().describe('New delivery mode. Omit to keep current.'),
                    message: z.string().nullable().optional().describe('New per-fire text override. null clears the override (fall back to item.content). Omit to keep current.'),
                }),
                func: async ({ triggerId, ...patch }: { triggerId: number } & AgendaTriggerUpdatePatch) => {
                    try {
                        const record = await agendaService.updateTrigger(triggerId, { ...patch, channelSessionId });
                        return record ? `Updated trigger #${triggerId} on agenda #${record.item.id}: ${record.item.content}` : `Trigger #${triggerId} not found.`;
                    } catch (e: any) {
                        return `Failed to update trigger #${triggerId}: ${e.message}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: AGENDA_TRIGGER_REMOVE_TOOL_NAME,
                description: descs.triggerRemove,
                schema: z.object({
                    triggerId: z.number().describe('Id of the trigger to disable. The agenda item itself stays.'),
                }),
                func: async ({ triggerId }: { triggerId: number }) => {
                    try {
                        const record = await agendaService.removeTrigger(triggerId);
                        return record ? `Removed trigger #${triggerId} from agenda #${record.item.id}: ${record.item.content}` : `Trigger #${triggerId} not found.`;
                    } catch (e: any) {
                        return `Failed to remove trigger #${triggerId}: ${e.message}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: AGENDA_TRIGGER_REPLACE_ALL_TOOL_NAME,
                description: descs.triggerReplaceAll,
                schema: z.object({
                    itemId: z.number().describe('Existing agenda item id.'),
                    triggers: z.array(TriggerSpecSchema).describe('FINAL active trigger list (replaces all current active triggers). [] = clear all active triggers.'),
                    action: z.enum(AgendaTriggerAction).optional().describe('Delivery mode applied to every new trigger in the list. Defaults to notify.'),
                    message: z.string().nullable().optional().describe('Per-fire text override applied to every new trigger. null/omit = fall back to item.content.'),
                }),
                func: async ({ itemId, ...args }: { itemId: number } & AgendaTriggerReplaceAllArgs) => {
                    try {
                        const record = await agendaService.replaceTriggers(itemId, { ...args, channelSessionId });
                        return record ? `Replaced triggers on agenda #${record.item.id}: ${record.item.content}` : `Agenda #${itemId} not found.`;
                    } catch (e: any) {
                        return `Failed to replace triggers on agenda #${itemId}: ${e.message}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: AGENDA_COMPLETE_TOOL_NAME,
                description: descs.complete,
                schema: z.object({
                    id: z.number().describe('Agenda item id.'),
                    at: z.string().optional().describe('Optional ISO datetime pointing at WHICH occurrence — only meaningful for completionMode=occurrence routines. With `at` the system searches BOTH pending and missed instances and picks the one with scheduledAt closest to `at`. Use it whenever the user references a specific past time, including backfilling missed instances ("16:38 喝了忘了说" → at=16:38 ISO; "周一的周报刚补交了" → at=that monday). Omit for plain "我喝了 / 完成了" check-ins — the system closes the earliest pending instance.'),
                }),
                func: async ({ id, at }: { id: number; at?: string }) => {
                    try {
                        const result = await agendaService.complete(id, at);
                        if (!result) return `Agenda #${id} not found.`;
                        const { record, closedOccurrence } = result;
                        const head = `agenda #${record.item.id}: ${record.item.content}`;
                        if (record.item.completionMode !== AgendaCompletionMode.Occurrence) {
                            return `Completed ${head}`;
                        }
                        if (!closedOccurrence) {
                            return `No matching occurrence to close on ${head}${at ? ` (requested at=${at})` : ' (no pending instance available)'}. Verify whether the routine has a pending/missed instance the user actually meant before retrying or apologizing.`;
                        }
                        const closedIso = new Date(closedOccurrence.scheduledAt).toISOString().slice(0, 16);
                        const fromStatus = closedOccurrence.status; // 关闭前的快照
                        const reqLine = at ? ` (requested at=${at})` : '';
                        return `Closed occurrence at ${closedIso} (was ${fromStatus}) on ${head}${reqLine}. If this scheduledAt does not match what the user described, the routing was approximate — clarify with the user before assuming success.`;
                    } catch (e: any) {
                        return `Failed to complete agenda #${id}: ${e.message}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: AGENDA_CANCEL_TOOL_NAME,
                description: descs.cancel,
                schema: z.object({
                    id: z.number().describe('Agenda item id to terminate. All active triggers are disabled; for occurrence routines the routine itself stops firing.'),
                }),
                func: async ({ id }: { id: number }) => {
                    try {
                        const record = await agendaService.cancel(id);
                        return record ? `Cancelled agenda #${record.item.id}: ${record.item.content}` : `Agenda #${id} not found.`;
                    } catch (e: any) {
                        return `Failed to cancel agenda #${id}: ${e.message}`;
                    }
                },
            }),
        ];
    }
}
