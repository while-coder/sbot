import { IAgentSaverService, ChatMessage, StoredMessage, ChatMessageOptions } from "./IAgentSaverService";

/**
 * 纯内存实现的 AgentSaver，不持久化。
 * 适用于临时会话、单次任务或测试场景。
 */
export class AgentMemorySaver implements IAgentSaverService {
    private messages: StoredMessage[] = [];
    private compactedIds = new Set<number>();
    private thinks: Record<string, StoredMessage[]> = {};
    private metadata: Record<string, string> = {};
    private nextId = 1;

    async getAllMessages(): Promise<StoredMessage[]> {
        return this.messages.filter(m => !this.compactedIds.has(m.id!));
    }

    async getMessages(): Promise<ChatMessage[]> {
        return (await this.getAllMessages()).map(r => r.message);
    }

    async pushMessage(message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
        this.messages.push({ id: this.nextId++, message, createdAt: Math.floor(Date.now() / 1000), thinkId: options?.thinkId });
        const nonCompacted = this.messages.filter(m => !this.compactedIds.has(m.id!));
        if (nonCompacted.length > 1000) {
            for (const m of nonCompacted.slice(0, nonCompacted.length - 1000)) {
                this.compactedIds.add(m.id!);
            }
        }
    }

    async replaceAllMessages(messages: StoredMessage[]): Promise<void> {
        const compacted = this.messages.filter(m => this.compactedIds.has(m.id!));
        this.messages = [...compacted, ...messages.map(m => ({ ...m, id: m.id ?? this.nextId++ }))];
    }

    async clearMessages(): Promise<void> {
        this.messages = [];
        this.compactedIds.clear();
        this.thinks = {};
    }

    async markMessagesAsCompacted(ids: number[]): Promise<void> {
        for (const id of ids) this.compactedIds.add(id);
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
