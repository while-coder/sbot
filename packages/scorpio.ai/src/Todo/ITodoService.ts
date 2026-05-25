import { TodoToolDescs } from "./Tools/TodoToolProvider";

export enum TodoStatus {
    Pending = 'pending',
    Done    = 'done',
}

export enum TodoPriority {
    Low    = 'low',
    Normal = 'normal',
    High   = 'high',
}

export interface Todo {
    id: number;
    content: string;
    status: TodoStatus;
    priority: TodoPriority;
    /** ISO 8601 字符串，仅展示用，不再触发 scheduler */
    deadline?: string;
    /** ISO 8601 字符串 */
    createdAt: string;
    /** ISO 8601 字符串，仅 status='done' 时设置 */
    doneAt?: string;
}

export interface TodoListFilter {
    status?: TodoStatus | 'all';
    /** 优先级过滤（默认全返回） */
    priority?: TodoPriority;
}

export interface ITodoService {
    /** 工具描述（供 TodoToolProvider 使用） */
    getToolDescs(): TodoToolDescs;

    /** 列出当前 session 的 todo（默认只 pending，按 priority/createdAt 排序） */
    list(filter?: TodoListFilter): Promise<Todo[]>;

    /** 渲染成 LLM 友好的 markdown — 用于 todo_list 工具输出 */
    formatForLLM(filter?: TodoListFilter): Promise<string>;

    /** 静默从对话中抽取并应用 CRUD，post-turn 调用 */
    extractFromConversation(userMessage: string, assistantMessages?: string[]): Promise<void>;
}

export const ITodoService = Symbol("ITodoService");
