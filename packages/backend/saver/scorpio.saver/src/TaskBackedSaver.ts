import {
    IAgentSaverService,
    ChatMessage,
    StoredMessage,
    NewStoredMessage,
    ChatMessageOptions,
} from "./IAgentSaverService";

/**
 * 子 Agent 专用 Saver。把 messages/metadata 操作映射到父 saver 的 task 作用域，
 * 使得子 Agent 的整段历史持久化在父 saver 的 `tasks[taskId]` 内，可跨调用恢复。
 *
 * 同时把每条 pushMessage 同步转发到父 saver 的 `pushThinkMessage(thinkId, ...)`，
 * 维持原有 thinks 实时显示行为。
 */
export class TaskBackedSaver implements IAgentSaverService {
    constructor(
        private readonly taskId: string,
        private readonly thinkId: string,
        private readonly parent: IAgentSaverService,
    ) {}

    // --- 主消息流（映射到 task 作用域） ---

    async getAllMessages(includeAll = false): Promise<StoredMessage[]> {
        return this.parent.getTaskMessages(this.taskId, includeAll);
    }

    async getMessages(): Promise<ChatMessage[]> {
        return (await this.getAllMessages()).map(s => s.message);
    }

    async pushMessage(message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
        await this.parent.pushTaskMessage(this.taskId, message, options);
        await this.parent.pushThinkMessage(this.thinkId, message, options);
    }

    async applyCompaction(compactedIds: number[], summary: NewStoredMessage): Promise<void> {
        await this.parent.applyTaskCompaction(this.taskId, compactedIds, summary);
    }

    async clearMessages(): Promise<void> {
        await this.parent.clearTask(this.taskId);
    }

    async searchArchive(_query: string[][], _limit?: number): Promise<StoredMessage[]> {
        return [];
    }

    // --- Think（透传给父 saver，支持嵌套 ReAct） ---

    async getThink(thinkId: string): Promise<StoredMessage[]> {
        return this.parent.getThink(thinkId);
    }

    async pushThinkMessage(thinkId: string, message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
        await this.parent.pushThinkMessage(thinkId, message, options);
    }

    // --- Metadata（task 作用域） ---

    async getMetadata(key: string): Promise<string | undefined> {
        return this.parent.getTaskMetadata(this.taskId, key);
    }

    async setMetadata(key: string, value: string): Promise<void> {
        await this.parent.setTaskMetadata(this.taskId, key, value);
    }

    // --- Task 作用域（嵌套 task 透传） ---

    async getTaskMessages(taskId: string, includeAll?: boolean): Promise<StoredMessage[]> {
        return this.parent.getTaskMessages(taskId, includeAll);
    }

    async pushTaskMessage(taskId: string, message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
        await this.parent.pushTaskMessage(taskId, message, options);
    }

    async applyTaskCompaction(taskId: string, compactedIds: number[], summary: NewStoredMessage): Promise<void> {
        await this.parent.applyTaskCompaction(taskId, compactedIds, summary);
    }

    async clearTask(taskId: string): Promise<void> {
        await this.parent.clearTask(taskId);
    }

    async getTaskMetadata(taskId: string, key: string): Promise<string | undefined> {
        return this.parent.getTaskMetadata(taskId, key);
    }

    async setTaskMetadata(taskId: string, key: string, value: string): Promise<void> {
        await this.parent.setTaskMetadata(taskId, key, value);
    }

    // --- 生命周期：不关闭父 saver ---

    async dispose(): Promise<void> {}
}
