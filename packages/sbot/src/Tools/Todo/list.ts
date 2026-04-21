import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { database, TodoRow } from '../../Core/Database';
import { LoggerService } from '../../Core/LoggerService';
import { loadPrompt } from '../../Core/PromptLoader';
import { TODO_LIST_TOOL_NAME } from './index';

const logger = LoggerService.getLogger('Tools/Todo/list.ts');

const PRIORITY_ORDER: Record<string, number> = { high: 0, normal: 1, low: 2 };

export function createTodoListTool(todoType: string, todoTargetId: string): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: TODO_LIST_TOOL_NAME,
        description: loadPrompt('tools/todo/list.txt'),
        schema: z.object({
            status: z.enum(['pending', 'done', 'all']).optional().describe('Filter by status (default: pending)'),
        }) as any,
        func: async ({ status }: any): Promise<MCPToolResult> => {
            try {
                const filter = status || 'pending';
                const where: any = { type: todoType, targetId: todoTargetId };
                if (filter !== 'all') where.status = filter;

                const todos = await database.findAll<TodoRow>(database.todo, { where });

                if (todos.length === 0) {
                    return createSuccessResult(createTextContent(
                        filter === 'all' ? 'No todo items' : `No ${filter} todo items`,
                    ));
                }

                const sorted = todos.sort((a, b) => {
                    const pa = PRIORITY_ORDER[a.priority] ?? 1;
                    const pb = PRIORITY_ORDER[b.priority] ?? 1;
                    if (pa !== pb) return pa - pb;
                    return a.createdAt - b.createdAt;
                });

                const lines = sorted.map(t => {
                    const check = t.status === 'done' ? '[x]' : '[ ]';
                    const dl = t.deadline ? ` — deadline: ${new Date(t.deadline).toLocaleString()}` : '';
                    const done = t.doneAt ? ` — done: ${new Date(t.doneAt).toLocaleString()}` : '';
                    return `${check} #${t.id} [${t.priority}] ${t.content}${dl}${done}`;
                });

                return createSuccessResult(createTextContent(
                    `${todos.length} todo(s):\n\n${lines.join('\n')}`,
                ));
            } catch (e: any) {
                logger.error(`todo_list failed: ${e.message}`);
                return createErrorResult(`Failed to list todos: ${e.message}`);
            }
        },
    });
}
