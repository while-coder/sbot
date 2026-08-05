import { z } from "zod";
import {
    AgendaTimeUnit,
    AgendaTriggerKind,
} from "./types";

interface AgendaTriggerSchemaFields {
    action: z.ZodTypeAny;
    message: z.ZodTypeAny;
    patchMessage: z.ZodTypeAny;
}

/**
 * agenda tool 与后台 extractor 共用的 trigger 协议。
 * action/message 的提示词由调用方提供，避免把 tool 专属说明带进 sync prompt。
 */
export function createAgendaTriggerSchemas(fields: AgendaTriggerSchemaFields) {
    const relativeTime = z.object({
        amount: z.number().int().positive(),
        unit: z.enum(AgendaTimeUnit).describe('minute / hour / day / week.'),
    });

    const TriggerSpecSchema = z.discriminatedUnion('kind', [
        z.object({
            kind: z.literal(AgendaTriggerKind.Absolute),
            at: z.string().describe('ISO datetime of the single fire moment, e.g. "2026-09-19T09:00:00". Compute relative times yourself.'),
            action: fields.action,
            message: fields.message,
        }).describe('One-shot trigger.'),
        z.object({
            kind: z.literal(AgendaTriggerKind.Interval),
            every: relativeTime.describe('Repeat interval, e.g. {amount:1,unit:"day"} = every day; {amount:90,unit:"minute"} = every 90 minutes.'),
            startAt: z.string().optional().describe('ISO of the first fire; omit for the default.'),
            count: z.number().int().positive().optional().describe('Total fire count; omit for unlimited.'),
            action: fields.action,
            message: fields.message,
        }).describe('Fixed-cadence recurrence.'),
        z.object({
            kind: z.literal(AgendaTriggerKind.Cron),
            expr: z.string().describe('SIX-field cron: "sec min hour dom month dow". NOT five-field. Example: "0 0 9 * * 1-5" = 9am weekdays.'),
            startAt: z.string().optional().describe('ISO of the first fire; omit for the default.'),
            count: z.number().int().positive().optional().describe('Total fire count; omit for unlimited.'),
            action: fields.action,
            message: fields.message,
        }).describe('Calendar-aligned recurrence.'),
    ]);

    const TriggerPatchSchema = z.object({
        kind: z.enum(AgendaTriggerKind).optional().describe('Only when switching trigger type; then the matching schedule field (at / every / expr) is mandatory. Omit to keep the current type.'),
        at: z.string().optional().describe('New ISO instant; for kind=absolute.'),
        every: relativeTime.optional().describe('New interval; for kind=interval.'),
        expr: z.string().optional().describe('New SIX-field cron expression; for kind=cron.'),
        startAt: z.string().optional().describe('Explicitly reset the next fire instant (ISO); use alone to postpone one occurrence without changing the cadence.'),
        count: z.number().int().positive().optional().describe('New total fire count; omit to keep it unchanged.'),
        action: fields.action,
        message: fields.patchMessage,
    }).describe('Only the fields to change; everything else keeps its current value and fire progress.');

    const TriggerEditSchema = z.discriminatedUnion('op', [
        z.object({
            op: z.literal('add'),
            spec: TriggerSpecSchema,
        }).describe('Append a new trigger.'),
        z.object({
            op: z.literal('patch'),
            id: z.number().describe('Existing trigger id.'),
            patch: TriggerPatchSchema,
        }).describe('Partially change one trigger, keeping its fire progress.'),
        z.object({
            op: z.literal('remove'),
            id: z.number().describe('Existing trigger id.'),
        }).describe('Disable one trigger. To reschedule, prefer patch; remove plus add loses fire progress.'),
    ]);

    return { TriggerSpecSchema, TriggerEditSchema };
}
