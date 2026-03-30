import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { database, SchedulerRow, SchedulerType } from '../../Core/Database';
import { LoggerService } from '../../Core/LoggerService';
import { loadPrompt } from '../../Core/PromptLoader';

const logger = LoggerService.getLogger('Tools/Scheduler/list.ts');

export function createSchedulerListTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'scheduler_list',
        description: loadPrompt('tools/scheduler/list.txt'),
        schema: z.object({
            type: z.enum(Object.values(SchedulerType) as [string, ...string[]]).optional().describe('Filter by type: channel | session | directory. Omit to return all.'),
        }) as any,
        func: async ({ type }: any): Promise<MCPToolResult> => {
            try {
                const options = type ? { where: { type } } : undefined;
                const timers = await database.findAll<SchedulerRow>(database.scheduler, options);

                if (timers.length === 0) {
                    return createSuccessResult(createTextContent('No scheduled tasks'));
                }

                const lines = timers.map((t: any) => {
                    const maxLabel = t.maxRuns ? `${t.runCount}/${t.maxRuns}` : `${t.runCount}`;
                    const next = t.nextRun ? new Date(t.nextRun).toLocaleString() : '-';
                    return `id=${t.id}  expr="${t.expr}"  type=${t.type ?? '-'}  target=${t.targetId ?? '-'}  runs=${maxLabel}  next=${next}\n  message: ${t.message}`;
                });

                return createSuccessResult(createTextContent(`${timers.length} tasks:\n\n${lines.join('\n\n')}`));
            } catch (e: any) {
                logger.error(`scheduler_list failed: ${e.message}`);
                return createErrorResult(`Failed to list scheduled tasks: ${e.message}`);
            }
        },
    });
}
