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
    type AgendaTriggerReplaceAllArgs,
    type AgendaTriggerSpec,
    type AgendaUpdatePatch,
} from "../types";
import { IAgendaService } from "../Service/IAgendaService";
import { TimeUtils } from "../../Utils/TimeUtils";
import { DEFAULT_LIST_LIMIT } from "../limits";

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

const ActionSchema = z.enum(AgendaTriggerAction).optional().describe('Per-trigger delivery mode. notify (default) = pure text ping; fire NOT recorded in conversation history. notify_and_record = same delivery + write fire as AI message into history (REQUIRED for occurrence routines / per-fire check-ins). invoke = feed fire text to the AI agent as user input so it actively responds (use when user wants AI work at fire time, e.g. "summarise the logs every morning at 8").');

const MessageSchema = z.string().nullable().optional().describe('Per-trigger override of the fire-time text. Default = item.content. Set when text needs to differ from content — friendlier reminder tone for notify; fuller instruction for invoke. null clears any override.');

const TriggerSpecSchema = z.discriminatedUnion('kind', [
    z.object({
        kind: z.literal(AgendaTriggerKind.Absolute),
        at: z.string().describe('ISO datetime when the trigger fires once, e.g. "2026-09-19T09:00:00". For "1 hour from now" / "100 days later", compute the ISO yourself from the current time.'),
        action: ActionSchema,
        message: MessageSchema,
    }).describe('One-shot at a specific moment.'),
    z.object({
        kind: z.literal(AgendaTriggerKind.Interval),
        every: RelativeTimeSchema.describe('Repeat interval. Examples: {amount:1,unit:"day"} = every day; {amount:90,unit:"minute"} = every 90 minutes.'),
        startAt: z.string().optional().describe('ISO datetime of the FIRST fire. Omit to fire one interval from now.'),
        count: z.number().int().positive().optional().describe('Total fire count before stopping. Omit for unlimited.'),
        action: ActionSchema,
        message: MessageSchema,
    }).describe('Fixed-cadence recurrence. Use this for "every day", "every 90 minutes" style requests; do NOT escalate to cron unless calendar alignment is required.'),
    z.object({
        kind: z.literal(AgendaTriggerKind.Cron),
        expr: z.string().describe('SIX-field cron expression: "sec min hour dom month dow". NOT five-field. Examples: "0 0 9 * * 1-5" = 9am on weekdays; "0 0 9 1 * *" = 9am on the 1st of every month.'),
        startAt: z.string().optional().describe('ISO datetime of the FIRST fire. Omit for the next cron match from now.'),
        count: z.number().int().positive().optional().describe('Total fire count before stopping. Omit for unlimited.'),
        action: ActionSchema,
        message: MessageSchema,
    }).describe('Calendar-aligned recurrence. Use only when interval cannot express it (e.g. "9am on weekdays", "the 1st of every month").'),
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
                    content: z.string().describe('Canonical, self-contained title used as the default fire-time text. A clean noun-phrase or imperative ("Drink water", "Submit weekly report"); not a reply or a kickoff sentence. Match the user\'s language.'),
                    category: z.enum(AgendaCategory).optional().describe('Usually omit — system infers from triggers (interval/cron→routine, absolute→reminder, none→todo). Only set to override.'),
                    priority: z.enum(AgendaPriority).optional().describe('Default normal. high for "important / urgent", low for casual / nice-to-have items.'),
                    triggers: z.array(TriggerSpecSchema).optional().describe('Schedule list; each element carries its own action/message. Omit or [] for a plain todo with no time. One element for a single schedule; multiple for several active schedules on the same item (e.g. "remind one day before AND at the deadline" — both with action=notify; or "morning invoke + evening notify").'),
                    dueAt: z.string().optional().describe('Explicit ISO deadline. Mainly for plain todos ("finish weekly report by Friday" → "2026-06-13T23:59:59"). PURE METADATA — used for dedup, overdue badge, and display; does NOT auto-create any trigger. If you want a deadline reminder, also include a trigger explicitly (e.g. triggers:[{kind:"absolute", at:"<dueAt ISO>"}]). For reminder/routine the deadline is auto-derived from triggers; only set this to override.'),
                    completionMode: z.enum(AgendaCompletionMode).optional().describe('Usually omit — system infers (todo→item, others→none). Set occurrence for routines where each fire is a separate instance the user must check off; pair every trigger\'s action with notify_and_record.'),
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
                    limit: z.number().int().positive().optional().describe(`Max items to return. Positive integer. Default ${DEFAULT_LIST_LIMIT}.`),
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
                schema: z.discriminatedUnion('kind', [
                    TriggerSpecSchema.options[0].extend({ itemId: z.number().describe('Existing agenda item id.') }),
                    TriggerSpecSchema.options[1].extend({ itemId: z.number().describe('Existing agenda item id.') }),
                    TriggerSpecSchema.options[2].extend({ itemId: z.number().describe('Existing agenda item id.') }),
                ]),
                func: async ({ itemId, ...spec }: { itemId: number } & AgendaTriggerSpec) => {
                    try {
                        const record = await agendaService.addTrigger(itemId, { ...(spec as AgendaTriggerSpec), channelSessionId });
                        return record ? `Added trigger to agenda #${record.item.id}: ${record.item.content}` : `Agenda #${itemId} not found.`;
                    } catch (e: any) {
                        return `Failed to add trigger to agenda #${itemId}: ${e.message}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: AGENDA_TRIGGER_UPDATE_TOOL_NAME,
                description: descs.triggerUpdate,
                schema: z.discriminatedUnion('kind', [
                    TriggerSpecSchema.options[0].extend({ triggerId: z.number().describe('Id of the existing trigger to rewrite.') }),
                    TriggerSpecSchema.options[1].extend({ triggerId: z.number().describe('Id of the existing trigger to rewrite.') }),
                    TriggerSpecSchema.options[2].extend({ triggerId: z.number().describe('Id of the existing trigger to rewrite.') }),
                ]),
                func: async ({ triggerId, ...spec }: { triggerId: number } & AgendaTriggerSpec) => {
                    try {
                        const record = await agendaService.updateTrigger(triggerId, { ...(spec as AgendaTriggerSpec), channelSessionId });
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
                    triggers: z.array(TriggerSpecSchema).describe('FINAL active trigger list (replaces all current active triggers). Each spec carries its own action/message. [] = clear all active triggers.'),
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
                    at: z.string().optional().describe('Optional ISO datetime pointing at WHICH occurrence — only meaningful for completionMode=occurrence routines. With `at` the system searches BOTH pending and missed instances and picks the one with scheduledAt closest to `at`. Use it whenever the user references a specific past time, including backfilling missed instances ("I drank water at 16:38, forgot to log" → at=16:38 ISO; "I just submitted Monday\'s report" → at=that monday). Omit for plain "I drank it / done" check-ins — the system closes the earliest pending instance.'),
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
                        const closedIso = TimeUtils.formatIsoMinute(closedOccurrence.scheduledAt);
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
