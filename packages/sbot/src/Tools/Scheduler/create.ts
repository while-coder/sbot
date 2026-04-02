import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { database, SchedulerRow } from '../../Core/Database';
import { schedulerService } from '../../Scheduler/SchedulerService';
import { LoggerService } from '../../Core/LoggerService';
import { loadPrompt } from '../../Core/PromptLoader';

const logger = LoggerService.getLogger('Tools/Scheduler/create.ts');

export function createSchedulerCreateTool(schedulerType: string, schedulerId: string): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'scheduler_create',
        description: loadPrompt('tools/scheduler/create.txt'),
        schema: z.object({
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
            message: z.string().describe('Message to send when the task fires'),
            maxRuns: z.number().optional().describe('Max executions (0 or omit = unlimited)'),
        }) as any,
        func: async ({ expr, message, maxRuns }: any): Promise<MCPToolResult> => {
            try {
                if (!expr?.trim())    return createErrorResult('expr is required');
                if (!message?.trim()) return createErrorResult('message is required');

                const row = await database.create<SchedulerRow>(database.scheduler, {
                    type:     schedulerType,
                    targetId: schedulerId,
                    expr:     expr.trim(),
                    message:  message.trim(),
                    lastRun:  null,
                    runCount: 0,
                    maxRuns:  maxRuns ?? 0,
                });
                await schedulerService.reload((row as any).id);
                const r = row as any;
                const maxLabel = r.maxRuns ? `max ${r.maxRuns}` : 'unlimited';
                return createSuccessResult(createTextContent(
                    `Created task id=${r.id}\n  expr: ${r.expr}\n  runs: ${maxLabel}\n  message: ${r.message}`,
                ));
            } catch (e: any) {
                logger.error(`scheduler_create failed: ${e.message}`);
                return createErrorResult(`Failed to create scheduled task: ${e.message}`);
            }
        },
    });
}
