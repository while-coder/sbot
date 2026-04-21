import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { database, TodoRow } from '../../Core/Database';
import { schedulerService } from '../../Scheduler/SchedulerService';
import { LoggerService } from '../../Core/LoggerService';
import { loadPrompt } from '../../Core/PromptLoader';
import { TODO_DONE_TOOL_NAME } from './index';

const logger = LoggerService.getLogger('Tools/Todo/done.ts');

export function createTodoDoneTool(todoType: string, todoTargetId: string): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: TODO_DONE_TOOL_NAME,
        description: loadPrompt('tools/todo/done.txt'),
        schema: z.object({
            id: z.number().describe('Todo item id (from todo_list)'),
        }) as any,
        func: async ({ id }: any): Promise<MCPToolResult> => {
            try {
                const existing = await database.findByPk<TodoRow>(database.todo, id);
                if (!existing) return createErrorResult(`Todo #${id} not found`);

                if (existing.type !== todoType || existing.targetId !== todoTargetId) {
                    return createErrorResult(
                        `Permission denied: todo #${id} does not belong to current session`,
                    );
                }

                if (existing.status === 'done') {
                    return createSuccessResult(createTextContent(`Todo #${id} is already done`));
                }

                const now = Date.now();
                await database.update(database.todo, { status: 'done', doneAt: now }, { where: { id } });

                if (existing.schedulerId) {
                    try {
                        await schedulerService.delete(existing.schedulerId);
                    } catch (e: any) {
                        logger.warn(`Failed to cancel scheduler ${existing.schedulerId} for todo #${id}: ${e.message}`);
                    }
                }

                return createSuccessResult(createTextContent(
                    `Completed todo #${id}: ${existing.content}`,
                ));
            } catch (e: any) {
                logger.error(`todo_done failed: ${e.message}`);
                return createErrorResult(`Failed to complete todo: ${e.message}`);
            }
        },
    });
}
