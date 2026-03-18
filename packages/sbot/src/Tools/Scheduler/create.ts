import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { database, SchedulerRow, ContextType } from '../../Core/Database';
import { schedulerService } from '../../Scheduler/SchedulerService';
import { LoggerService } from '../../Core/LoggerService';
import { loadPrompt } from '../../Core/PromptLoader';

const logger = LoggerService.getLogger('Tools/Scheduler/create.ts');

export function createSchedulerCreateTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'scheduler_create',
        description: loadPrompt('tools/scheduler/create.txt'),
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
