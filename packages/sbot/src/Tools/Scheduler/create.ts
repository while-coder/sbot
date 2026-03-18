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
            expr:    z.string().describe(
                'Cron expression, always 6-field: <second> <minute> <hour> <day> <month> <weekday>\n' +
                'Field values: * = any, */n = every n units, n = exact, n-m = range, n,m = list. Weekday: 0=Sun…6=Sat.\n' +
                'Examples:\n' +
                '  "0 0 9 * * *"     every day at 09:00:00\n' +
                '  "0 30 18 * * 1-5" weekdays at 18:30:00\n' +
                '  "0 0 */2 * * *"   every 2 hours\n' +
                '  "0 */15 * * * *"  every 15 minutes\n' +
                '  "0 0 9 1 * *"     1st of every month at 09:00:00\n' +
                '  "*/30 * * * * *"  every 30 seconds\n' +
                '  "0 */5 * * * *"   every 5 minutes\n' +
                'One-shot (run exactly once): pin all fields + set maxRuns=1.\n' +
                '  "0 30 14 25 3 *"  → Mar 25 at 14:30:00, once'
            ),
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
                return createSuccessResult(createTextContent(`Scheduled task created: id=${(row as any).id} name=${(row as any).name} expr=${(row as any).expr}`));
            } catch (e: any) {
                logger.error(`scheduler_create failed: ${e.message}`);
                return createErrorResult(`Failed to create scheduled task: ${e.message}`);
            }
        },
    });
}
