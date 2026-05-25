import fsp from "fs/promises";
import path from "path";
import { inject, T_TodoFilePath, T_TodoToolDescs } from "../Core";
import { ILoggerService } from "../Logger";
import {
    ITodoService, Todo, TodoListFilter, TodoPriority, TodoStatus,
} from "./ITodoService";
import { ITodoExtractor, TodoActionType } from "./Extractor/ITodoExtractor";
import { TodoToolDescs } from "./Tools/TodoToolProvider";

interface TodoFile {
    todos: Todo[];
    nextId: number;
}

const PRIORITY_ORDER: Record<TodoPriority, number> = { high: 0, normal: 1, low: 2 };

export class TodoService implements ITodoService {
    private logger;

    constructor(
        @inject(T_TodoFilePath) private filePath: string,
        @inject(T_TodoToolDescs) private toolDescs: TodoToolDescs,
        @inject(ITodoExtractor, { optional: true }) private extractor?: ITodoExtractor,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
    ) {
        this.logger = loggerService?.getLogger("TodoService");
        this.logger?.debug(`TodoService initialized: filePath=${filePath}, extractor=${!!extractor}`);
    }

    getToolDescs(): TodoToolDescs {
        return this.toolDescs;
    }

    async list(filter?: TodoListFilter): Promise<Todo[]> {
        this.logger?.debug(`list called: filter=${JSON.stringify(filter ?? {})}`);
        const data = await this.read();
        const status = filter?.status ?? TodoStatus.Pending;
        let items = data.todos;
        if (status !== 'all') items = items.filter(t => t.status === status);
        if (filter?.priority) items = items.filter(t => t.priority === filter.priority);
        const result = items.sort((a, b) => {
            const dp = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
            if (dp !== 0) return dp;
            return a.createdAt.localeCompare(b.createdAt);
        });
        this.logger?.debug(`list result: total=${data.todos.length}, filtered=${result.length}`);
        return result;
    }

    async formatForLLM(filter?: TodoListFilter): Promise<string> {
        const items = await this.list(filter);
        if (items.length === 0) {
            const which = filter?.status && filter.status !== 'all' ? filter.status : TodoStatus.Pending;
            return `No ${which} todo items.`;
        }
        const lines = items.map(t => {
            const check = t.status === TodoStatus.Done ? '[x]' : '[ ]';
            const dl = t.deadline ? ` (due ${t.deadline})` : '';
            return `${check} #${t.id} [${t.priority}] ${t.content}${dl}`;
        });
        return `${items.length} todo(s):\n\n${lines.join('\n')}`;
    }

    async extractFromConversation(userMessage: string, assistantMessages?: string[]): Promise<void> {
        if (!this.extractor) {
            this.logger?.debug(`extractFromConversation skipped: no extractor configured`);
            return;
        }
        this.logger?.debug(`extractFromConversation start: userMsgLen=${userMessage.length}, assistantMsgs=${assistantMessages?.length ?? 0}`);
        try {
            const data = await this.read();
            const actions = await this.extractor.extract(
                userMessage,
                assistantMessages ?? [],
                data.todos,
            );
            this.logger?.debug(`extractor returned ${actions.length} action(s)`);
            if (actions.length === 0) return;

            for (const a of actions) {
                if (a.action === TodoActionType.Create) {
                    const content = a.content?.trim();
                    if (!content) continue;
                    const id = data.nextId++;
                    data.todos.push({
                        id,
                        content,
                        status: TodoStatus.Pending,
                        priority: a.priority ?? TodoPriority.Normal,
                        deadline: a.deadline,
                        createdAt: new Date().toISOString(),
                    });
                    this.logger?.info(`Todo auto-created: #${id} ${content}`);
                } else if (a.action === TodoActionType.Done) {
                    const t = data.todos.find(t => t.id === a.id);
                    if (!t || t.status === TodoStatus.Done) continue;
                    t.status = TodoStatus.Done;
                    t.doneAt = new Date().toISOString();
                    this.logger?.info(`Todo auto-done: #${t.id}`);
                } else if (a.action === TodoActionType.Patch) {
                    const t = data.todos.find(t => t.id === a.id);
                    if (!t) continue;
                    if (a.content?.trim()) t.content = a.content.trim();
                    if (a.priority) t.priority = a.priority;
                    if (a.deadline !== undefined) t.deadline = a.deadline;
                    this.logger?.info(`Todo auto-patched: #${t.id}`);
                } else if (a.action === TodoActionType.Delete) {
                    const idx = data.todos.findIndex(t => t.id === a.id);
                    if (idx >= 0) {
                        const removed = data.todos.splice(idx, 1)[0];
                        this.logger?.info(`Todo auto-deleted: #${removed.id}`);
                    }
                }
            }

            await this.write(data);
            this.logger?.debug(`extractFromConversation done: applied ${actions.length} action(s)`);
        } catch (error: any) {
            this.logger?.error(`Todo extraction failed: ${error.message}`);
        }
    }

    private async read(): Promise<TodoFile> {
        try {
            const buf = await fsp.readFile(this.filePath, 'utf-8');
            const parsed = JSON.parse(buf) as Partial<TodoFile>;
            const file = {
                todos: Array.isArray(parsed.todos) ? parsed.todos : [],
                nextId: typeof parsed.nextId === 'number' ? parsed.nextId : 1,
            };
            this.logger?.debug(`read: ${file.todos.length} todo(s), nextId=${file.nextId}`);
            return file;
        } catch (e: any) {
            if (e.code === 'ENOENT') {
                this.logger?.debug(`read: file not found at ${this.filePath}, returning empty`);
                return { todos: [], nextId: 1 };
            }
            this.logger?.warn(`Failed to read todos at ${this.filePath}: ${e.message}; returning empty`);
            return { todos: [], nextId: 1 };
        }
    }

    private async write(data: TodoFile): Promise<void> {
        const dir = path.dirname(this.filePath);
        await fsp.mkdir(dir, { recursive: true });
        const tmp = `${this.filePath}.tmp`;
        try {
            await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8');
            await fsp.rename(tmp, this.filePath);
            this.logger?.debug(`write: ${data.todos.length} todo(s), nextId=${data.nextId} -> ${this.filePath}`);
        } catch (e) {
            await fsp.unlink(tmp).catch(() => {});
            throw e;
        }
    }
}
