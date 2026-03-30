import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { database, SchedulerRow } from '../../Core/Database';
import { schedulerService } from '../../Scheduler/SchedulerService';
import { LoggerService } from '../../Core/LoggerService';
import { loadPrompt } from '../../Core/PromptLoader';

const logger = LoggerService.getLogger('Tools/Scheduler/delete.ts');

export function createSchedulerDeleteTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'scheduler_delete',
        description: loadPrompt('tools/scheduler/delete.txt'),
        schema: z.object({
            id: z.number().describe('Task id (from scheduler_list)'),
        }) as any,
        func: async ({ id }: any): Promise<MCPToolResult> => {
            try {
                const existing = await database.findByPk<SchedulerRow>(database.scheduler, id);
                if (!existing) return createErrorResult(`Scheduled task id=${id} not found`);
                const ex = existing as any;
                await schedulerService.delete(id);
                return createSuccessResult(createTextContent(
                    `Deleted task id=${id} (expr="${ex.expr}", message="${ex.message}")`,
                ));
            } catch (e: any) {
                logger.error(`scheduler_delete failed: ${e.message}`);
                return createErrorResult(`Failed to delete scheduled task: ${e.message}`);
            }
        },
    });
}
