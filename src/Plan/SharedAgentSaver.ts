import { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { BaseMessage } from "langchain";
import { IAgentSaverService } from "scorpio.ai";

/**
 * 共享 AgentSaver 包装器
 * 
 * 当多个 Sub-Agent 共享同一个 AgentSaver 实例时，使用此包装器
 * 可以防止 Sub-Agent 在完成后 dispose 关闭共享的数据库连接。
 * 
 * 所有操作委托给内部 saver，但 dispose() 是空操作。
 * 只有持有原始 saver 的所有者才应负责关闭连接。
 */
export class SharedAgentSaver implements IAgentSaverService {
    constructor(private inner: IAgentSaverService) {}

    getCheckpointer(): Promise<BaseCheckpointSaver> {
        return this.inner.getCheckpointer();
    }

    clearThread(threadId: string): Promise<void> {
        return this.inner.clearThread(threadId);
    }

    getMessages(threadId: string): Promise<BaseMessage[]> {
        return this.inner.getMessages(threadId);
    }

    prepareHistory(threadId: string): Promise<BaseMessage[]> {
        return this.inner.prepareHistory(threadId);
    }

    truncateMessages(messages: BaseMessage[], maxTokens: number): BaseMessage[] {
        return this.inner.truncateMessages(messages, maxTokens);
    }

    /**
     * 空操作 - 不关闭共享的数据库连接
     * 由原始所有者负责 dispose
     */
    async dispose(): Promise<void> {
        // 不做任何事情，避免关闭共享连接
    }
}
