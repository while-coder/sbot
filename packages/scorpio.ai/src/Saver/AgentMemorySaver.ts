import { BaseMessage } from "langchain";
import { IAgentSaverService, SaverMessage } from "./IAgentSaverService";
import { applyTokenLimit } from "./messageSerializer";

/**
 * 纯内存实现的 AgentSaver，不持久化。
 * 适用于临时会话、单次任务或测试场景。
 */
export class AgentMemorySaver implements IAgentSaverService {
    private messages: SaverMessage[] = [];
    private thinks: Record<string, SaverMessage[]> = {};

    async getAllMessages(): Promise<BaseMessage[]> {
        return this.messages.map((r) => r.message);
    }

    async getAllMessagesWithTime(): Promise<SaverMessage[]> {
        return [...this.messages];
    }

    async getMessages(maxTokens: number): Promise<BaseMessage[]> {
        return applyTokenLimit(this.messages.map((r) => r.message), maxTokens);
    }

    async pushMessage(message: BaseMessage): Promise<void> {
        this.messages.push({ message, createdAt: Math.floor(Date.now() / 1000) });
    }

    async clearMessages(): Promise<void> {
        this.messages = [];
        this.thinks = {};
    }

    async getThink(thinkId: string): Promise<SaverMessage[]> {
        return this.thinks[thinkId] ?? [];
    }

    async pushThinkMessages(thinkId: string, messages: BaseMessage[]): Promise<void> {
        const existing = this.thinks[thinkId] ?? [];
        const newRows: SaverMessage[] = messages.map((m) => ({
            message: m,
            createdAt: Math.floor(Date.now() / 1000),
        }));
        this.thinks[thinkId] = [...existing, ...newRows];
    }

    async dispose(): Promise<void> {}
}
