import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { ITodoService, TodoListFilter, TodoPriority, TodoStatus } from "../ITodoService";

export const TODO_LIST_TOOL_NAME = 'todo_list' as const;

export interface TodoToolDescs {
    list: string;
}

export class TodoToolProvider {
    /**
     * 创建 Todo 工具列表，描述从 service 的 getToolDescs() 获取。
     * Todo 是单 service（按 session 隔离），不像 memory/wiki 可以多个并存。
     */
    static getTools(todoService: ITodoService): DynamicStructuredTool[] {
        const descs = todoService.getToolDescs();
        return [
            TodoToolProvider.createListTool(todoService, descs.list),
        ];
    }

    private static createListTool(todoService: ITodoService, description: string): DynamicStructuredTool {
        return new DynamicStructuredTool({
            name: TODO_LIST_TOOL_NAME,
            description,
            schema: z.object({
                status: z.enum([TodoStatus.Pending, TodoStatus.Done, 'all']).optional().describe('Filter by status (default: pending)'),
                priority: z.enum(TodoPriority).optional().describe('Filter by priority'),
            }),
            func: async ({ status, priority }) => {
                try {
                    const filter: TodoListFilter = {};
                    if (status) filter.status = status;
                    if (priority) filter.priority = priority;
                    return await todoService.formatForLLM(filter);
                } catch (e: any) {
                    return `Failed to list todos: ${e.message}`;
                }
            },
        });
    }
}
