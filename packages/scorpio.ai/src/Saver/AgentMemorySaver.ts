import { IAgentSaverService, ChatMessage, StoredMessage, ChatMessageOptions } from "./IAgentSaverService";

/**
 * 纯内存实现的 AgentSaver，不持久化。
 * 适用于临时会话、单次任务或测试场景。
 */
export class AgentMemorySaver implements IAgentSaverService {
    private messages: StoredMessage[] = [];
    private thinks: Record<string, StoredMessage[]> = {};
    private metadata: Record<string, string> = {};
    private nextId = 1;

    async getAllMessages(): Promise<StoredMessage[]> {
        return this.messages.filter(m => !m.compacted);
    }

    async getMessages(): Promise<ChatMessage[]> {
        return (await this.getAllMessages()).map(r => r.message);
    }

    async pushMessage(message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
        this.messages.push({ id: this.nextId++, message, createdAt: Math.floor(Date.now() / 1000), thinkId: options?.thinkId });
    }

    async applyCompaction(compactedIds: number[], summary: StoredMessage): Promise<void> {
        const set = new Set(compactedIds);
        for (const m of this.messages) {
            if (m.id != null && set.has(m.id)) m.compacted = true;
        }
        this.messages.push({ ...summary, id: summary.id ?? this.nextId++ });
    }

    async clearMessages(): Promise<void> {
        this.messages = [];
        this.thinks = {};
    }

    async searchMessages(query: string, limit: number = 20): Promise<StoredMessage[]> {
        const lower = query.toLowerCase();
        return this.messages
            .filter(m => {
                const c = m.message.content;
                return (typeof c === 'string' ? c : JSON.stringify(c)).toLowerCase().includes(lower);
            })
            .slice(-limit);
    }

    async getThink(thinkId: string): Promise<StoredMessage[]> {
        return this.thinks[thinkId] ?? [];
    }

    async pushThinkMessage(thinkId: string, message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
        const existing = this.thinks[thinkId] ?? [];
        existing.push({ message, createdAt: Math.floor(Date.now() / 1000), thinkId: options?.thinkId });
        this.thinks[thinkId] = existing;
    }

    async getMetadata(key: string): Promise<string | undefined> {
        return this.metadata[key];
    }

    async setMetadata(key: string, value: string): Promise<void> {
        this.metadata[key] = value;
    }

    async dispose(): Promise<void> {}
}
