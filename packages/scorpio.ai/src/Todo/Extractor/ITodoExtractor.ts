import type { Todo, TodoPriority } from "../ITodoService";

export const enum TodoActionType {
    Create = 'create',
    Patch = 'patch',
    Done = 'done',
    Delete = 'delete',
}

/**
 * Create: content 必填，id 留空
 * Patch:  id 必填，content/priority/deadline 至少填一个
 * Done / Delete: 仅 id 必填
 */
export interface TodoAction {
    action: TodoActionType;
    id?: number;
    content?: string;
    priority?: TodoPriority;
    /** ISO 8601 */
    deadline?: string;
}

export interface ITodoExtractor {
    extract(userMessage: string, assistantMessages: string[], existingTodos: Todo[]): Promise<TodoAction[]>;
}

export const ITodoExtractor = Symbol("ITodoExtractor");
