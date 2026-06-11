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
export const AGENDA_SKIP_NEXT_TOOL_NAME = 'agenda_skip_next' as const;

const RelativeTimeSchema = z.object({
    amount: z.number().describe('Positive amount'),
    unit: z.enum(AgendaTimeUnit).describe('Time unit'),
});

export class AgendaToolProvider {
    static getTools(agendaService: IAgendaService): DynamicStructuredTool[] {
        const descs = agendaService.getToolDescs();
        return [
            new DynamicStructuredTool({
                name: AGENDA_CREATE_TOOL_NAME,
                description: descs.create,
                schema: z.object({
                    content: z.string().describe('Agenda item content, e.g. "喝水" or "交周报"'),
                    category: z.enum(AgendaCategory).optional(),
                    priority: z.enum(AgendaPriority).optional(),
                    at: z.string().optional().describe('Absolute ISO datetime. Use for "tomorrow at 9" or a concrete time.'),
                    after: RelativeTimeSchema.optional().describe('Relative one-shot time, e.g. {amount:1,unit:"hour"}.'),
                    every: RelativeTimeSchema.optional().describe('Recurring interval, e.g. {amount:1,unit:"day"}.'),
                    cron: z.string().optional().describe('Six-field cron expression when an exact cron schedule is needed.'),
                    startAt: z.string().optional().describe('Used with every/cron: ISO datetime of the FIRST fire. Subsequent fires follow every/cron rhythm.'),
                    startAfter: RelativeTimeSchema.optional().describe('Used with every/cron: delay before the first fire, e.g. {amount:100,unit:"day"} for "remind starting 100 days from now". Subsequent fires follow every/cron rhythm.'),
                    count: z.number().int().positive().optional().describe('Used with every/cron: total number of fires before stopping. Omit for unlimited.'),
                    timezone: z.string().optional().describe('IANA timezone. Default is local runtime timezone.'),
                    action: z.enum(AgendaTriggerAction).optional().describe('notify=send reminder, send=send raw message, invoke=ask agent to process message.'),
                    message: z.string().optional().describe('Optional message/prompt used when the trigger fires. Defaults to content.'),
                    completionMode: z.enum(AgendaCompletionMode).optional(),
                }),
                func: async (args: AgendaCreateArgs) => {
                    try {
                        const result = await agendaService.create(args);
                        const item = result.item;
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
                    at: z.string().optional().describe('Replace existing triggers with a new absolute ISO datetime trigger.'),
                    after: RelativeTimeSchema.optional().describe('Replace existing triggers with a new relative one-shot trigger.'),
                    every: RelativeTimeSchema.optional().describe('Replace existing triggers with a new recurring interval trigger.'),
                    cron: z.string().optional().describe('Replace existing triggers with a new six-field cron trigger.'),
                    startAt: z.string().optional().describe('With every/cron: ISO datetime of the FIRST fire.'),
                    startAfter: RelativeTimeSchema.optional().describe('With every/cron: delay before the first fire.'),
                    count: z.number().int().positive().optional().describe('With every/cron: total number of fires before stopping.'),
                    timezone: z.string().nullable().optional(),
                    action: z.enum(AgendaTriggerAction).optional(),
                    message: z.string().nullable().optional(),
                }),
                func: async ({ id, ...patch }: { id: number } & AgendaUpdatePatch) => {
                    try {
                        const item = await agendaService.update(id, patch);
                        return item ? `Updated agenda #${item.id}: ${item.content}` : `Agenda #${id} not found.`;
                    } catch (e: any) {
                        return `Failed to update agenda #${id}: ${e.message}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: AGENDA_COMPLETE_TOOL_NAME,
                description: descs.complete,
                schema: z.object({ id: z.number() }),
                func: async ({ id }: { id: number }) => {
                    try {
                        const item = await agendaService.complete(id);
                        return item ? `Completed agenda #${item.id}: ${item.content}` : `Agenda #${id} not found.`;
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
                        const item = await agendaService.cancel(id);
                        return item ? `Cancelled agenda #${item.id}: ${item.content}` : `Agenda #${id} not found.`;
                    } catch (e: any) {
                        return `Failed to cancel agenda #${id}: ${e.message}`;
                    }
                },
            }),
            new DynamicStructuredTool({
                name: AGENDA_SKIP_NEXT_TOOL_NAME,
                description: descs.skipNext,
                schema: z.object({ id: z.number() }),
                func: async ({ id }: { id: number }) => {
                    try {
                        const item = await agendaService.skipNext(id);
                        return item ? `Skipped next trigger for agenda #${item.id}: ${item.content}` : `Agenda #${id} not found.`;
                    } catch (e: any) {
                        return `Failed to skip next agenda trigger #${id}: ${e.message}`;
                    }
                },
            }),
        ];
    }
}
