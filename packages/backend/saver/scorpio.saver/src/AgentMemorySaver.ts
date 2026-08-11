import {
    IAgentSaverService,
    ChatMessage,
    StoredMessage,
    NewStoredMessage,
    ChatMessageOptions,
    MessageKind,
} from "./IAgentSaverService";

interface TaskEntry {
    messages: StoredMessage[];
    metadata: Record<string, string>;
}

/**
 * 纯内存实现的 AgentSaver，不持久化。
 * 适用于临时会话、单次任务或测试场景。
 */
export class AgentMemorySaver implements IAgentSaverService {
    private messages: StoredMessage[] = [];
    private thinks: Record<string, StoredMessage[]> = {};
    private tasks: Record<string, TaskEntry> = {};
    private metadata: Record<string, string> = {};
    private nextId = 1;

    private getOrCreateTask(taskId: string): TaskEntry {
        let entry = this.tasks[taskId];
        if (!entry) {
            entry = { messages: [], metadata: {} };
            this.tasks[taskId] = entry;
        }
        return entry;
    }

    async getAllMessages(includeAll = false): Promise<StoredMessage[]> {
        return includeAll
            ? [...this.messages]
            : this.messages.filter(m => m.kind === MessageKind.Normal);
    }

    async getMessages(): Promise<ChatMessage[]> {
        return (await this.getAllMessages()).map(r => r.message);
    }

    async pushMessage(message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
        this.messages.push({
            id: this.nextId++,
            message,
            createdAt: Math.floor(Date.now() / 1000),
            thinkId: options?.thinkId,
            taskId: options?.taskId,
            kind: options?.kind ?? MessageKind.Normal,
        });
    }

    async applyCompaction(compactedIds: number[], summary: NewStoredMessage): Promise<void> {
        const set = new Set(compactedIds);
        for (const m of this.messages) {
            if (set.has(m.id)) m.kind = MessageKind.Archive;
        }
        this.messages.push({
            ...summary,
            id: this.nextId++,
            createdAt: Math.floor(Date.now() / 1000),
            kind: summary.kind,
        });
    }

    async clearMessages(): Promise<void> {
        this.messages = [];
        this.thinks = {};
    }

    async searchArchive(query: string[][], limit: number = 20): Promise<StoredMessage[]> {
        if (query.length === 0 || query.some(g => g.length === 0)) return [];
        const groups = query.map(g => g.map(t => t.toLowerCase()));
        return this.messages
            .filter(m => {
                if (m.kind !== MessageKind.Archive) return false;
                const c = m.message.content;
                const text = (typeof c === 'string' ? c : JSON.stringify(c)).toLowerCase();
                return groups.every(group => group.some(t => text.includes(t)));
            })
            .slice(-limit);
    }

    async getThink(thinkId: string): Promise<StoredMessage[]> {
        return this.thinks[thinkId] ?? [];
    }

    async pushThinkMessage(thinkId: string, message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
        const existing = this.thinks[thinkId] ?? [];
        existing.push({
            id: this.nextId++,
            message,
            createdAt: Math.floor(Date.now() / 1000),
            thinkId: options?.thinkId,
            kind: options?.kind ?? MessageKind.Normal,
        });
        this.thinks[thinkId] = existing;
    }

    async getMetadata(key: string): Promise<string | undefined> {
        return this.metadata[key];
    }

    async setMetadata(key: string, value: string): Promise<void> {
        this.metadata[key] = value;
    }

    // --- Task scope ---

    async getTaskMessages(taskId: string, includeAll = false): Promise<StoredMessage[]> {
        const entry = this.tasks[taskId];
        if (!entry) return [];
        return includeAll
            ? [...entry.messages]
            : entry.messages.filter(m => m.kind === MessageKind.Normal);
    }

    async pushTaskMessage(taskId: string, message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
        const entry = this.getOrCreateTask(taskId);
        entry.messages.push({
            id: this.nextId++,
            message,
            createdAt: Math.floor(Date.now() / 1000),
            thinkId: options?.thinkId,
            kind: options?.kind ?? MessageKind.Normal,
        });
    }

    async applyTaskCompaction(taskId: string, compactedIds: number[], summary: NewStoredMessage): Promise<void> {
        const entry = this.getOrCreateTask(taskId);
        const set = new Set(compactedIds);
        for (const m of entry.messages) {
            if (set.has(m.id)) m.kind = MessageKind.Archive;
        }
        entry.messages.push({
            ...summary,
            id: this.nextId++,
            createdAt: Math.floor(Date.now() / 1000),
            kind: summary.kind,
        });
    }

    async clearTask(taskId: string): Promise<void> {
        delete this.tasks[taskId];
    }

    async getTaskMetadata(taskId: string, key: string): Promise<string | undefined> {
        return this.tasks[taskId]?.metadata[key];
    }

    async setTaskMetadata(taskId: string, key: string, value: string): Promise<void> {
        const entry = this.getOrCreateTask(taskId);
        entry.metadata[key] = value;
    }

    async dispose(): Promise<void> {}
}
