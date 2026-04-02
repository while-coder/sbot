import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { database, SchedulerRow } from '../../Core/Database';
import { LoggerService } from '../../Core/LoggerService';
import { loadPrompt } from '../../Core/PromptLoader';
import { SCHEDULER_LIST_TOOL_NAME } from './index';

const logger = LoggerService.getLogger('Tools/Scheduler/list.ts');

export function createSchedulerListTool(schedulerType: string, schedulerId: string): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: SCHEDULER_LIST_TOOL_NAME,
        description: loadPrompt('tools/scheduler/list.txt'),
        schema: z.object({}) as any,
        func: async (_args: any): Promise<MCPToolResult> => {
            try {
                const timers = await database.findAll<SchedulerRow>(database.scheduler, {
                    where: { type: schedulerType, targetId: schedulerId, disabled: false },
                });

                if (timers.length === 0) {
                    return createSuccessResult(createTextContent('No scheduled tasks'));
                }

                const lines = timers.map((t: any) => {
                    const maxLabel = t.maxRuns ? `${t.runCount}/${t.maxRuns}` : `${t.runCount}`;
                    const next = t.nextRun ? new Date(t.nextRun).toLocaleString() : '-';
                    return `id=${t.id}  expr="${t.expr}"  runs=${maxLabel}  next=${next}\n  message: ${t.message}`;
                });

                return createSuccessResult(createTextContent(`${timers.length} tasks:\n\n${lines.join('\n\n')}`));
            } catch (e: any) {
                logger.error(`scheduler_list failed: ${e.message}`);
                return createErrorResult(`Failed to list scheduled tasks: ${e.message}`);
            }
        },
    });
}
