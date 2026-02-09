import { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { BaseMessage } from "langchain";

/**
 * Agent Saver 接口
 * 提供对话历史的持久化存储和检索功能
 */
export interface IAgentSaver {
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
     * 释放资源（如数据库连接）
     */
    dispose(): Promise<void>;
}

/**
 * IAgentSaver 的依赖注入标识符
 */
export const IAgentSaver = Symbol.for("IAgentSaver");
