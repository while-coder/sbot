import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import {
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
import { formatAgendaXml } from "../format";
import { DEFAULT_LIST_LIMIT } from "../limits";

export const AGENDA_CREATE_TOOL_NAME = 'agenda_create' as const;
export const AGENDA_LIST_TOOL_NAME = 'agenda_list' as const;
export const AGENDA_UPDATE_TOOL_NAME = 'agenda_update' as const;
export const AGENDA_TRIGGER_TOOL_NAME = 'agenda_trigger' as const;
export const AGENDA_COMPLETE_TOOL_NAME = 'agenda_complete' as const;
export const AGENDA_CANCEL_TOOL_NAME = 'agenda_cancel' as const;
export const AGENDA_WIKI_TOOL_NAME = 'agenda_wiki' as const;

const AGENDA_WIKI_TOOL_DESCRIPTION = `Agenda system decision rules / deep manual. Call when uncertain about any agenda operation — meaning, parameter choice, edge case, cross-tool sync. No parameters.`;

export enum AgendaTriggerOp {
    Add = 'add',
    Update = 'update',
    Remove = 'remove',
    ReplaceAll = 'replace_all',
}

const RelativeTimeSchema = z.object({
    amount: z.number().int().positive(),
    unit: z.enum(AgendaTimeUnit).describe('minute / hour / day / week.'),
});

const ActionSchema = z.enum(AgendaTriggerAction).optional().describe('notify (default, plain-text reminder) / notify_and_record (also records the fire into the conversation history) / invoke (AI actively produces at fire time, e.g. "generate/summarize/write/organize for me"). Details → agenda_wiki §8.');

const MessageSchema = z.string().min(1).describe('REQUIRED per-trigger fire-time text — the exact words delivered WHEN this trigger fires, phrased as a present-moment ping ("Time to drink water"), NOT as a request to set a reminder ("remind me to drink water in 2 min" ✗). No fallback to content; if no special wording, restate content. Recorded fires re-enter the conversation, so request-like wording can make the post-turn sync create a duplicate agenda.');

const StartAtSchema = z.string().optional().describe('ISO of FIRST fire; omit for default.');
const CountSchema = z.number().int().positive().optional().describe('Total fire count; omit for unlimited.');

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
        expr: z.string().describe('SIX-field cron: "sec min hour dom month dow" (NOT 5-field). Example: "0 0 9 * * 1-5" = 9am weekdays.'),
        startAt: StartAtSchema,
        count: CountSchema,
        action: ActionSchema,
        message: MessageSchema,
    }).describe('Calendar-aligned recurrence.'),
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
                    content: z.string().describe('Self-contained title, match user language. Just the thing itself ("Drink water" / "Submit weekly report") — do NOT bake in relative time or schedule ("remind me to drink water in 2 min" ✗); timing lives in triggers.'),
                    priority: z.enum(AgendaPriority).optional().describe('Default normal. high = urgent; low = casual.'),
                    triggers: z.array(TriggerSpecSchema).optional().describe('Schedule list; omit / [] = plain todo.'),
                    dueAt: z.string().optional().describe('ISO deadline. Pure metadata — does NOT auto-create a trigger (agenda_wiki §3).'),
                }),
                func: async (args: AgendaCreateArgs) => {
                    try {
                        const result = await agendaService.create({ ...args, channelSessionId });
                        const item = result.item.item;
                        if (result.existed) {
                            return `Agenda #${item.id} already exists: ${item.content}\nNo new agenda item was created.`;
                        }
                        // 直接渲染刚创建的这条（含 trigger id），不要用全局 list+limit:1——
                        // 那会按排序返回"最靠前"的一条，未必是新建的这条。
                        return `Created agenda #${item.id}: ${item.content}\n\n${formatAgendaXml(result.item)}`;
                    } catch (e: any) {
                        return `Failed to create agenda item: ${e.message}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: AGENDA_LIST_TOOL_NAME,
                description: descs.list,
                schema: z.object({
                    status: z.enum([AgendaStatus.Pending, AgendaStatus.Done, AgendaStatus.Cancelled, 'all']).optional().describe('Default pending. "all" = no filter.'),
                    priority: z.enum(AgendaPriority).optional(),
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
                name: AGENDA_UPDATE_TOOL_NAME,
                description: descs.update,
                schema: z.object({
                    id: z.number().describe('Item id.'),
                    content: z.string().optional(),
                    priority: z.enum(AgendaPriority).optional(),
                    dueAt: z.string().nullable().optional().describe('ISO or null. Does NOT retime triggers (agenda_wiki §3).'),
                }),
                func: async ({ id, ...patch }: { id: number } & AgendaUpdatePatch) => {
                    try {
                        const record = await agendaService.update(id, patch);
                        return record ? `Updated agenda #${record.item.id}: ${record.item.content}` : `Agenda #${id} not found.`;
                    } catch (e: any) {
                        return `Failed to update agenda #${id}: ${e.message}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: AGENDA_TRIGGER_TOOL_NAME,
                description: descs.trigger,
                schema: z.object({
                    op: z.enum(AgendaTriggerOp).describe('add = append ONE trigger / update = rewrite ONE existing trigger / remove = disable ONE trigger / replace_all = replace the FULL active trigger list.'),
                    itemId: z.number().optional().describe('Existing item id. Required for op=add / op=replace_all.'),
                    triggerId: z.number().optional().describe('Existing trigger id (from <existing-agenda> XML). Required for op=update / op=remove.'),
                    trigger: TriggerSpecSchema.optional().describe('Spec to append (op=add) or COMPLETE replacement spec (op=update; resets fireCount). Shape = create.triggers[i].'),
                    triggers: z.array(TriggerSpecSchema).optional().describe('Final active list for op=replace_all. [] clears all.'),
                }),
                func: async (args: { op: AgendaTriggerOp } & Record<string, any>) => {
                    try {
                        switch (args.op) {
                            case AgendaTriggerOp.Add: {
                                const itemId = args.itemId as number;
                                const spec = args.trigger as AgendaTriggerSpec;
                                const record = await agendaService.addTrigger(itemId, { ...spec, channelSessionId });
                                return record ? `Added trigger to agenda #${record.item.id}: ${record.item.content}` : `Agenda #${itemId} not found.`;
                            }
                            case AgendaTriggerOp.Update: {
                                const triggerId = args.triggerId as number;
                                const spec = args.trigger as AgendaTriggerSpec;
                                const record = await agendaService.updateTrigger(triggerId, { ...spec, channelSessionId });
                                return record ? `Updated trigger #${triggerId} on agenda #${record.item.id}: ${record.item.content}` : `Trigger #${triggerId} not found.`;
                            }
                            case AgendaTriggerOp.Remove: {
                                const triggerId = args.triggerId as number;
                                const record = await agendaService.removeTrigger(triggerId);
                                return record ? `Removed trigger #${triggerId} from agenda #${record.item.id}: ${record.item.content}` : `Trigger #${triggerId} not found.`;
                            }
                            case AgendaTriggerOp.ReplaceAll: {
                                const itemId = args.itemId as number;
                                const triggers = args.triggers as AgendaTriggerSpec[];
                                const record = await agendaService.replaceTriggers(itemId, { triggers, channelSessionId } satisfies AgendaTriggerReplaceAllArgs);
                                return record ? `Replaced triggers on agenda #${record.item.id}: ${record.item.content}` : `Agenda #${itemId} not found.`;
                            }
                        }
                    } catch (e: any) {
                        return `Failed agenda_trigger op=${args.op}: ${e.message}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: AGENDA_COMPLETE_TOOL_NAME,
                description: descs.complete,
                schema: z.object({
                    id: z.number().describe('Item id.'),
                }),
                func: async ({ id }: { id: number }) => {
                    try {
                        const record = await agendaService.complete(id);
                        if (!record) return `Agenda #${id} not found.`;
                        return `Completed agenda #${record.item.id}: ${record.item.content}`;
                    } catch (e: any) {
                        return `Failed to complete agenda #${id}: ${e.message}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: AGENDA_CANCEL_TOOL_NAME,
                description: descs.cancel,
                schema: z.object({
                    id: z.number().describe('Item id to terminate.'),
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
            new DynamicStructuredTool({
                name: AGENDA_WIKI_TOOL_NAME,
                description: AGENDA_WIKI_TOOL_DESCRIPTION,
                schema: z.object({}),
                func: async () => descs.wiki,
            }),
        ];
    }
}
