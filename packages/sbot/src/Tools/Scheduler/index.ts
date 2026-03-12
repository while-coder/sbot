/**
 * Scheduler tools
 */

import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { database, SchedulerRow, ContextType } from '../../Core/Database';
import { schedulerService } from '../../Scheduler/SchedulerService';
import { LoggerService } from '../../Core/LoggerService';

const logger = LoggerService.getLogger('Tools/Scheduler/index.ts');

// ─────────────────────────────────────────────────────────────────────────────
// scheduler_list
// ─────────────────────────────────────────────────────────────────────────────

export function createSchedulerListTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'scheduler_list',
        description: 'List scheduled tasks (id, name, expr, type, message, userId, sessionId, workPath, lastRun). Call before create/delete to check for duplicates or find a task id. Optionally filter by type.',
        schema: z.object({
            type: z.enum(Object.values(ContextType) as [string, ...string[]]).optional().describe('Filter by type: channel | session | directory. Omit to return all.'),
        }) as any,
        func: async ({ type }: any): Promise<MCPToolResult> => {
            try {
                const options = type ? { where: { type } } : undefined;
                const timers = await database.findAll<SchedulerRow>(database.scheduler, options);
                return createSuccessResult(createTextContent(JSON.stringify(timers, null, 2)));
            } catch (e: any) {
                logger.error(`scheduler_list failed: ${e.message}`);
                return createErrorResult(`Failed to list scheduled tasks: ${e.message}`);
            }
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// scheduler_create
// ─────────────────────────────────────────────────────────────────────────────

export function createSchedulerCreateTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'scheduler_create',
        description: `Create a scheduled task with a 5-field cron expression (minute hour day month weekday, server timezone).

Cron examples: daily 09:00="0 9 * * *"  every Monday="0 9 * * 1"  every 30min="*/30 * * * *"

Routing — set exactly one field based on conversation-type, leave others null:
  channel   → userId    = <current-user><db-id>
  session   → sessionId = <environment><scheduler-session-id>
  directory → workPath  = <environment><paths><working-directory dir="...">`,
        schema: z.object({
            name:      z.string().describe('Task name'),
            expr:      z.string().describe('5-field cron: minute hour day month weekday'),
            type:      z.enum(Object.values(ContextType) as [string, ...string[]]).optional().describe('channel | session | directory — must match the routing field'),
            message:   z.string().describe('Message to send when the task fires'),
            userId:    z.number().optional().describe('channel only: integer from <current-user><db-id>'),
            sessionId: z.string().optional().describe('session only: value from <environment><scheduler-session-id>'),
            workPath:  z.string().optional().describe('directory only: dir attribute of <environment><paths><working-directory>'),
        }) as any,
        func: async ({ name, expr, type, message, userId, sessionId, workPath }: any): Promise<MCPToolResult> => {
            try {
                if (!name?.trim())    return createErrorResult('name is required');
                if (!expr?.trim())    return createErrorResult('expr is required');
                if (!message?.trim()) return createErrorResult('message is required');

                const row = await database.create<SchedulerRow>(database.scheduler, {
                    name:      name.trim(),
                    expr:      expr.trim(),
                    type:      type ?? null,
                    message:   message.trim(),
                    userId:    userId ?? null,
                    sessionId: sessionId ?? null,
                    workPath:  workPath ?? null,
                    lastRun:   null,
                });
                await schedulerService.reload((row as any).id);
                return createSuccessResult(createTextContent(`Scheduled task created:\n${JSON.stringify(row, null, 2)}`));
            } catch (e: any) {
                logger.error(`scheduler_create failed: ${e.message}`);
                return createErrorResult(`Failed to create scheduled task: ${e.message}`);
            }
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// scheduler_delete
// ─────────────────────────────────────────────────────────────────────────────

export function createSchedulerDeleteTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'scheduler_delete',
        description: 'Delete and cancel a scheduled task by id. Use scheduler_list first if you need to find the id.',
        schema: z.object({
            id: z.number().describe('Task id (from scheduler_list)'),
        }) as any,
        func: async ({ id }: any): Promise<MCPToolResult> => {
            try {
                const existing = await database.findByPk<SchedulerRow>(database.scheduler, id);
                if (!existing) return createErrorResult(`Scheduled task id=${id} not found`);
                schedulerService.cancel(id);
                await database.destroy(database.scheduler, { where: { id } });
                return createSuccessResult(createTextContent(`Scheduled task id=${id} (${existing.name}) deleted`));
            } catch (e: any) {
                logger.error(`scheduler_delete failed: ${e.message}`);
                return createErrorResult(`Failed to delete scheduled task: ${e.message}`);
            }
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool set
// ─────────────────────────────────────────────────────────────────────────────

export function createSchedulerTools(): StructuredToolInterface[] {
    return [
        createSchedulerListTool(),
        createSchedulerCreateTool(),
        createSchedulerDeleteTool(),
    ];
}
