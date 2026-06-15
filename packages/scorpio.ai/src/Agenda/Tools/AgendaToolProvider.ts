import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
    AgendaCategory,
    AgendaCompletionMode,
    AgendaListView,
    AgendaPriority,
    AgendaStatus,
    AgendaTimeUnit,
    AgendaTriggerAction,
    AgendaTriggerKind,
    type AgendaCreateArgs,
    type AgendaListFilter,
    type AgendaUpdatePatch,
} from "../types";
import { IAgendaService } from "../Service/IAgendaService";

export const AGENDA_CREATE_TOOL_NAME = 'agenda_create' as const;
export const AGENDA_LIST_TOOL_NAME = 'agenda_list' as const;
export const AGENDA_UPDATE_TOOL_NAME = 'agenda_update' as const;
export const AGENDA_COMPLETE_TOOL_NAME = 'agenda_complete' as const;
export const AGENDA_CANCEL_TOOL_NAME = 'agenda_cancel' as const;

const RelativeTimeSchema = z.object({
    amount: z.number().describe('Positive amount'),
    unit: z.enum(AgendaTimeUnit).describe('Time unit'),
});

const TriggerSpecSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal(AgendaTriggerKind.Absolute),
        at: z.string().describe('ISO datetime when the trigger fires once, e.g. "2026-09-19T09:00:00". For "1 hour from now"-style requests, compute the ISO yourself from the current time.'),
    }).describe('One-shot trigger at a specific moment.'),
    z.object({
        kind: z.literal(AgendaTriggerKind.Interval),
        every: RelativeTimeSchema.describe('Repeat interval, e.g. {amount:1,unit:"day"} for every day, {amount:90,unit:"minute"} for every 90 minutes.'),
        startAt: z.string().optional().describe('ISO datetime of the FIRST fire. Omit to fire one interval from now. For "starting 100 days from now", compute the ISO yourself.'),
        count: z.number().int().positive().optional().describe('Total number of fires before stopping. Omit for unlimited.'),
    }).describe('Recurring trigger at a fixed interval.'),
    z.object({
        kind: z.literal(AgendaTriggerKind.Cron),
        expr: z.string().describe('Six-field cron expression (sec min hour dom month dow), e.g. "0 0 9 * * 1-5" for 9am on weekdays.'),
        startAt: z.string().optional().describe('ISO datetime of the FIRST fire. Omit for the next cron match from now.'),
        count: z.number().int().positive().optional().describe('Total number of fires before stopping. Omit for unlimited.'),
    }).describe('Recurring trigger on a cron schedule.'),
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
                    content: z.string().describe('Agenda item content, e.g. "喝水" or "交周报"'),
                    category: z.enum(AgendaCategory).optional(),
                    priority: z.enum(AgendaPriority).optional(),
                    trigger: TriggerSpecSchema.optional().describe('Schedule of when this fires. Omit for plain todo without a time.'),
                    dueAt: z.string().optional().describe('Optional ISO datetime deadline. Mainly for plain todos ("finish weekly report by Friday" → "2026-06-13T23:59:59"). When set without a `trigger`, the system auto-fires a one-shot reminder at this moment so the deadline does not pass silently. For Reminder/Routine the deadline is auto-derived from the trigger; only set this when you need to override.'),
                    action: z.enum(AgendaTriggerAction).optional().describe('notify=send the message text as-is to the user; the fire is NOT recorded in the conversation history (default; for one-shot reminders / external pings where the user reply does not need fire context). notify_and_record=same as notify, but also append the message to the conversation history as an AI message so the main agent sees that the system pinged the user — use this for occurrence routines (打卡/汇报/喝水) so the agent can correctly read user replies like "已喝/已交". invoke=feed the message to the AI agent as user input so it actively responds. Write any "提醒：..." prefix yourself in the message field if you want one.'),
                    message: z.string().optional().describe('Optional override for the text delivered when the trigger fires. Leave empty to deliver `content` as-is — only fill this when the delivered text needs to differ from `content` (e.g. content="分析昨日日志" as a short title, message="请分析昨天的 nginx 日志，找出 5xx 异常..." as the full instruction the AI agent should process).'),
                    completionMode: z.enum(AgendaCompletionMode).optional(),
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
                    status: z.enum([AgendaStatus.Pending, AgendaStatus.Done, AgendaStatus.Cancelled, 'all']).optional(),
                    category: z.enum(AgendaCategory).optional(),
                    priority: z.enum(AgendaPriority).optional(),
                    view: z.enum(AgendaListView).optional(),
                    limit: z.number().optional(),
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
                    id: z.number(),
                    content: z.string().optional(),
                    category: z.enum(AgendaCategory).optional(),
                    priority: z.enum(AgendaPriority).optional(),
                    completionMode: z.enum(AgendaCompletionMode).optional(),
                    dueAt: z.string().nullable().optional(),
                    trigger: TriggerSpecSchema.optional().describe('Replace existing triggers with a new schedule. Omit to keep current triggers.'),
                    action: z.enum(AgendaTriggerAction).optional(),
                    message: z.string().nullable().optional(),
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
                name: AGENDA_COMPLETE_TOOL_NAME,
                description: descs.complete,
                schema: z.object({
                    id: z.number(),
                    at: z.string().optional().describe('Optional ISO datetime pointing at WHICH occurrence the user is completing — only meaningful for completionMode=occurrence routines. With `at` the system searches BOTH pending and missed instances and picks the one with scheduledAt closest to `at`. Use it whenever the user references a specific past time, including backfilling missed instances ("16:38 喝了忘了说" → at=16:38 ISO; "周一的周报刚补交了" → at=that monday). Omit for plain "我喝了 / 完成了" check-ins — the system closes the earliest pending instance.'),
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
                schema: z.object({ id: z.number() }),
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
