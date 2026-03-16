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
        description: 'List scheduled tasks (id, name, expr, type, message, targetId, lastRun, runCount, maxRuns). Call before create/delete to check for duplicates or find a task id. Optionally filter by type.',
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
        description: 'Create a scheduled task. type and id come from <environment>; expr is a 5-field cron expression.',
        schema: z.object({
            name:    z.string().describe('Task name'),
            expr:    z.string().describe('5-field cron (minute hour day month weekday). Examples: "0 9 * * *"=daily 09:00  "0 9 * * 1"=Mon 09:00  "*/30 * * * *"=every 30min'),
            type:    z.enum(Object.values(ContextType) as [string, ...string[]]).describe('"channel" | "session" | "directory" — from <environment><conversation-type>'),
            id:      z.string().describe('From <environment><scheduler-id>'),
            message: z.string().describe('Message to send when the task fires'),
            maxRuns: z.number().optional().describe('Max executions (0 or omit = unlimited)'),
        }) as any,
        func: async ({ name, expr, type, id, message, maxRuns }: any): Promise<MCPToolResult> => {
            try {
                if (!name?.trim())    return createErrorResult('name is required');
                if (!expr?.trim())    return createErrorResult('expr is required');
                if (!id?.trim())      return createErrorResult('id is required');
                if (!message?.trim()) return createErrorResult('message is required');

                const row = await database.create<SchedulerRow>(database.scheduler, {
                    name:     name.trim(),
                    expr:     expr.trim(),
                    type:     type ?? null,
                    message:  message.trim(),
                    targetId: id.trim(),
                    lastRun:  null,
                    runCount: 0,
                    maxRuns:  maxRuns ?? 0,
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
                await schedulerService.delete(id);
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
