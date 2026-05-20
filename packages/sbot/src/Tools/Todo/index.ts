import { type StructuredToolInterface } from '@langchain/core/tools';

export const TODO_CREATE_TOOL_NAME = 'todo_create' as const;
export const TODO_LIST_TOOL_NAME   = 'todo_list'   as const;
export const TODO_DONE_TOOL_NAME   = 'todo_done'   as const;

/** 仅用于 admin/管理端展示工具 schema 的占位 sessionId，绝不应在运行时被调用 */
export const PREVIEW_TARGET_ID = '__preview__';

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
