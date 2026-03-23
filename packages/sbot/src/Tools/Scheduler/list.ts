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
                return createSuccessResult(createTextContent(JSON.stringify(timers, null, 2)));
            } catch (e: any) {
                logger.error(`scheduler_list failed: ${e.message}`);
                return createErrorResult(`Failed to list scheduled tasks: ${e.message}`);
            }
        },
    });
}
