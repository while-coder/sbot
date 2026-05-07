import { IAgentSaverService, ChatMessage, StoredMessage, ChatMessageOptions } from "./IAgentSaverService";
import { applyTokenLimit } from "./messageSerializer";

/**
 * 纯内存实现的 AgentSaver，不持久化。
 * 适用于临时会话、单次任务或测试场景。
 */
export class AgentMemorySaver implements IAgentSaverService {
    private messages: StoredMessage[] = [];
    private thinks: Record<string, StoredMessage[]> = {};
    private metadata: Record<string, string> = {};

    async getAllMessages(): Promise<StoredMessage[]> {
        return [...this.messages];
    }

    async getMessages(maxTokens: number): Promise<ChatMessage[]> {
        return applyTokenLimit(this.messages.map((r) => r.message), maxTokens);
    }

    async pushMessage(message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
        this.messages.push({ message, createdAt: Math.floor(Date.now() / 1000), thinkId: options?.thinkId });
    }

    async replaceAllMessages(messages: StoredMessage[]): Promise<void> {
        this.messages = [...messages];
        this.thinks = {};
    }

    async clearMessages(): Promise<void> {
        this.messages = [];
        this.thinks = {};
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
