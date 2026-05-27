import { readFile, writeFile, unlink, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { dirname } from "path";
import {
    IAgentSaverService,
    ChatMessage,
    StoredMessage,
    NewStoredMessage,
    ChatMessageOptions,
    MessageKind,
} from "./IAgentSaverService";
import { ILoggerService, ILogger } from "../Logger";
import { inject } from "scorpio.di";
import { T_DBPath } from "../Core/tokens";

interface TaskEntry {
    messages: StoredMessage[];
    metadata: Record<string, string>;
}

interface ThreadFile {
    messages: StoredMessage[];
    thinks: Record<string, StoredMessage[]>;
    tasks: Record<string, TaskEntry>;
    metadata: Record<string, string>;
    nextId: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// AgentFileSaver
// 直接读写指定的 JSON 文件，存储格式为 StoredMessage[]
// ─────────────────────────────────────────────────────────────────────────────

export class AgentFileSaver implements IAgentSaverService {
    private logger?: ILogger;
    private readonly filePath: string;
    private cache?: ThreadFile;

    constructor(
        @inject(T_DBPath) filePath: string,
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService
    ) {
        this.filePath = filePath;
        this.logger = loggerService?.getLogger("AgentFileSaver");
    }

    private async getFile(): Promise<ThreadFile> {
        if (this.cache) return this.cache;
        try {
            if (!existsSync(this.filePath)) {
                this.cache = { messages: [], thinks: {}, tasks: {}, metadata: {}, nextId: 1 };
            } else {
                const content = await readFile(this.filePath, "utf-8");
                this.cache = JSON.parse(content) as ThreadFile;
                if (!this.cache.messages) this.cache.messages = [];
                if (!this.cache.thinks) this.cache.thinks = {};
                if (!this.cache.tasks) this.cache.tasks = {};
                if (!this.cache.metadata) this.cache.metadata = {};
                if (!this.cache.nextId) this.cache.nextId = 1;
                let nextId = this.cache.nextId;
                const now = Math.floor(Date.now() / 1000);
                for (const m of this.cache.messages) {
                    if (m.id == null) m.id = nextId++;
                    else nextId = Math.max(nextId, m.id + 1);
                    if (m.createdAt == null) m.createdAt = now;
                    if (!m.kind) m.kind = MessageKind.Normal;
                }
                this.cache.nextId = nextId;
                for (const items of Object.values(this.cache.thinks)) {
                    for (const m of items) {
                        if (m.id == null) m.id = nextId++;
                        else nextId = Math.max(nextId, m.id + 1);
                        if (m.createdAt == null) m.createdAt = now;
                        if (!m.kind) m.kind = MessageKind.Normal;
                    }
                }
                this.cache.nextId = nextId;
                for (const entry of Object.values(this.cache.tasks)) {
                    if (!entry.messages) entry.messages = [];
                    if (!entry.metadata) entry.metadata = {};
                    for (const m of entry.messages) {
                        if (m.id == null) m.id = nextId++;
                        else nextId = Math.max(nextId, m.id + 1);
                        if (m.createdAt == null) m.createdAt = now;
                        if (!m.kind) m.kind = MessageKind.Normal;
                    }
                }
                this.cache.nextId = nextId;
            }
        } catch (error: any) {
            this.logger?.warn(`读取文件失败: ${error.message}`);
            this.cache = { messages: [], thinks: {}, tasks: {}, metadata: {}, nextId: 1 };
        }
        return this.cache!;
    }

    private getOrCreateTask(file: ThreadFile, taskId: string): TaskEntry {
        let entry = file.tasks[taskId];
        if (!entry) {
            entry = { messages: [], metadata: {} };
            file.tasks[taskId] = entry;
        }
        return entry;
    }

    private async writeThreadFile(file: ThreadFile): Promise<void> {
        const dir = dirname(this.filePath);
        if (!existsSync(dir)) await mkdir(dir, { recursive: true });
        await writeFile(this.filePath, JSON.stringify(file), "utf-8");
    }

    async pushMessage(message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
        const file = await this.getFile();
        const id = file.nextId;
        file.nextId = id + 1;
        file.messages.push({
            id,
            message,
            createdAt: Math.floor(Date.now() / 1000),
            thinkId: options?.thinkId,
            taskId: options?.taskId,
            kind: options?.kind ?? MessageKind.Normal,
        });
        await this.writeThreadFile(file);
    }

    async getAllMessages(includeAll = false): Promise<StoredMessage[]> {
        const file = await this.getFile();
        return includeAll
            ? [...file.messages]
            : file.messages.filter(m => m.kind === MessageKind.Normal);
    }

    async getMessages(): Promise<ChatMessage[]> {
        return (await this.getAllMessages()).map((r) => r.message);
    }

    async applyCompaction(compactedIds: number[], summary: NewStoredMessage): Promise<void> {
        if (compactedIds.length === 0) return;
        const file = await this.getFile();
        const set = new Set(compactedIds);
        for (const m of file.messages) {
            if (set.has(m.id)) m.kind = MessageKind.Archive;
        }
        const id = file.nextId;
        file.nextId = id + 1;
        file.messages.push({
            ...summary,
            id,
            createdAt: Math.floor(Date.now() / 1000),
        });
        await this.writeThreadFile(file);
    }

    async searchArchive(query: string[][], limit: number = 20): Promise<StoredMessage[]> {
        if (query.length === 0 || query.some(g => g.length === 0)) return [];
        const groups = query.map(g => g.map(t => t.toLowerCase()));
        const file = await this.getFile();
        return file.messages
            .filter(m => {
                if (m.kind !== MessageKind.Archive) return false;
                const c = m.message.content;
                const text = (typeof c === 'string' ? c : JSON.stringify(c)).toLowerCase();
                return groups.every(group => group.some(t => text.includes(t)));
            })
            .slice(-limit);
    }

    async clearMessages(): Promise<void> {
        this.cache = undefined;
        if (existsSync(this.filePath)) {
            await unlink(this.filePath);
        }
    }

    async getThink(thinkId: string): Promise<StoredMessage[]> {
        return (await this.getFile()).thinks[thinkId] ?? [];
    }

    async pushThinkMessage(thinkId: string, message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
        const file = await this.getFile();
        const existing = file.thinks[thinkId] ?? [];
        const id = file.nextId;
        file.nextId = id + 1;
        existing.push({
            id,
            message,
            createdAt: Math.floor(Date.now() / 1000),
            thinkId: options?.thinkId,
            kind: options?.kind ?? MessageKind.Normal,
        });
        file.thinks[thinkId] = existing;
        await this.writeThreadFile(file);
    }

    async getMetadata(key: string): Promise<string | undefined> {
        return (await this.getFile()).metadata[key];
    }

    async setMetadata(key: string, value: string): Promise<void> {
        const file = await this.getFile();
        file.metadata[key] = value;
        await this.writeThreadFile(file);
    }

    // --- Task scope ---

    async getTaskMessages(taskId: string, includeAll = false): Promise<StoredMessage[]> {
        const file = await this.getFile();
        const entry = file.tasks[taskId];
        if (!entry) return [];
        return includeAll
            ? [...entry.messages]
            : entry.messages.filter(m => m.kind === MessageKind.Normal);
    }

    async pushTaskMessage(taskId: string, message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
        const file = await this.getFile();
        const entry = this.getOrCreateTask(file, taskId);
        const id = file.nextId;
        file.nextId = id + 1;
        entry.messages.push({
            id,
            message,
            createdAt: Math.floor(Date.now() / 1000),
            thinkId: options?.thinkId,
            kind: options?.kind ?? MessageKind.Normal,
        });
        await this.writeThreadFile(file);
    }

    async applyTaskCompaction(taskId: string, compactedIds: number[], summary: NewStoredMessage): Promise<void> {
        const file = await this.getFile();
        const entry = this.getOrCreateTask(file, taskId);
        const set = new Set(compactedIds);
        for (const m of entry.messages) {
            if (set.has(m.id)) m.kind = MessageKind.Archive;
        }
        const id = file.nextId;
        file.nextId = id + 1;
        entry.messages.push({
            ...summary,
            id,
            createdAt: Math.floor(Date.now() / 1000),
        });
        await this.writeThreadFile(file);
    }

    async clearTask(taskId: string): Promise<void> {
        const file = await this.getFile();
        if (file.tasks[taskId]) {
            delete file.tasks[taskId];
            await this.writeThreadFile(file);
        }
    }

    async getTaskMetadata(taskId: string, key: string): Promise<string | undefined> {
        const file = await this.getFile();
        return file.tasks[taskId]?.metadata[key];
    }

    async setTaskMetadata(taskId: string, key: string, value: string): Promise<void> {
        const file = await this.getFile();
        const entry = this.getOrCreateTask(file, taskId);
        entry.metadata[key] = value;
        await this.writeThreadFile(file);
    }

    async dispose(): Promise<void> {}
}
