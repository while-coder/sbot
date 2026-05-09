import { type StructuredToolInterface } from '@langchain/core/tools';

export const TODO_CREATE_TOOL_NAME = 'todo_create' as const;
export const TODO_LIST_TOOL_NAME   = 'todo_list'   as const;
export const TODO_DONE_TOOL_NAME   = 'todo_done'   as const;

export { createTodoCreateTool } from './create';
export { createTodoListTool } from './list';
export { createTodoDoneTool } from './done';

import { createTodoCreateTool } from './create';
import { createTodoListTool } from './list';
import { createTodoDoneTool } from './done';

export function createTodoTools(targetId: string): StructuredToolInterface[] {
    return [
        createTodoListTool(targetId),
        createTodoCreateTool(targetId),
        createTodoDoneTool(targetId),
    ];
}
