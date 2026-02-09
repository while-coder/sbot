import { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { BaseMessage } from "langchain";

/**
 * Agent Saver 接口
 * 提供对话历史的持久化存储和检索功能
 */
export interface IAgentSaverService {
    /**
     * 获取 LangGraph 的 CheckpointSaver 实例
     * 用于在 LangGraph 编译时作为 checkpointer
     */
    getCheckpointer(): Promise<BaseCheckpointSaver>;

    /**
     * 清除指定线程的所有历史记录
     * @param threadId 线程ID
     */
    clearThread(threadId: string): Promise<void>;

    /**
     * 获取指定线程的历史消息
     * @param threadId 线程ID
     * @returns 历史消息数组，如果没有历史则返回空数组
     */
    getMessages(threadId: string): Promise<BaseMessage[]>;

    /**
     * 准备历史记录用于 stream
     * 如果历史记录超过限制，返回截断后的历史消息并清理 saver
     * 否则返回空数组（使用 saver 中的历史）
     * @param threadId 线程ID
     */
    prepareHistory(threadId: string): Promise<BaseMessage[]>;

    /**
     * 智能截断消息历史，确保不会破坏 tool_calls 和 ToolMessage 的配对
     * @param messages 原始消息数组
     * @param maxCount 最大保留数量
     * @returns 截断后的消息数组
     */
    truncateMessages(messages: BaseMessage[], maxCount: number): BaseMessage[];

    /**
     * 释放资源（如数据库连接）
     */
    dispose(): Promise<void>;
}

/**
 * IAgentSaverService 的依赖注入标识符
 */
export const IAgentSaverService = Symbol.for("IAgentSaverService");
