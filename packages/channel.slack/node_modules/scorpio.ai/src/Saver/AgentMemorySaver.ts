import { BaseMessage } from "langchain";
import { IAgentSaverService } from "./IAgentSaverService";
import { applyTokenLimit } from "./messageSerializer";

/**
 * 纯内存实现的 AgentSaver，不持久化。
 * 适用于临时会话、单次任务或测试场景。
 */
export class AgentMemorySaver implements IAgentSaverService {
    readonly threadId: string;
    private messages: BaseMessage[] = [];

    constructor() {
        this.threadId = `mem_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }

    async getAllThreadIds(): Promise<string[]> {
        return [this.threadId];
    }

    async getAllMessages(): Promise<BaseMessage[]> {
        return [...this.messages];
    }

    async getMessages(maxTokens: number): Promise<BaseMessage[]> {
        return applyTokenLimit(this.messages, maxTokens);
    }

    async pushMessage(message: BaseMessage): Promise<void> {
        message.additional_kwargs = { ...message.additional_kwargs, created_at: Math.floor(Date.now() / 1000) };
        this.messages.push(message);
    }

    async clearMessages(): Promise<void> {
        this.messages = [];
    }

    async dispose(): Promise<void> {}
}
