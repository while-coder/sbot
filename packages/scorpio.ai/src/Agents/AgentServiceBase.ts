import type { BaseMessage } from "langchain";
import { ServiceContainer } from "scorpio.di";
import { IMemoryService } from "../Memory";
import { IAgentSaverService, AgentMemorySaver, ChatMessage, ChatToolCall, MessageRole } from "../Saver";
import { ILoggerService, ILogger } from "../Logger";


export const MAX_HISTORY_TOKENS = 150_000;

// ─────────────────────────────────────────────────────────────────────────────
// 公共类型定义
// ─────────────────────────────────────────────────────────────────────────────

export { ChatMessage, MessageRole };

export enum GraphNodeType {
    AGENT = "agent",
    TOOLS = "tools",
}

export enum ToolApproval {
    /** 拒绝本次执行 */
    Deny = "deny",
    /** 同意本次执行 */
    Allow = "allow",
    /** 一直同意（相同参数） */
    AlwaysArgs = "alwaysArgs",
    /** 一直同意（此工具所有参数） */
    AlwaysTool = "alwaysTool",
}

/** 向后兼容别名：AgentToolCall 与 ChatToolCall 结构相同 */
export type AgentToolCall = ChatToolCall;

/** 向后兼容别名：AgentMessage 已统一为 ChatMessage */
export type AgentMessage = ChatMessage;

/**
 * Agent 回调接口 - 统一管理消息、流式、工具确认和图片转换回调
 */
export interface IAgentCallback {
    /**
     * 接收完整的消息（在节点输出完成后触发）
     */
    onMessage?(message: ChatMessage): Promise<void>;

    /**
     * 接收实时的流式消息块（在模型生成过程中触发）
     */
    onStreamMessage?(message: ChatMessage): Promise<void>;

    /**
     * 工具执行前进行确认
     * @returns ToolApproval 枚举，表示执行意图
     */
    executeTool?(toolCall: ChatToolCall): Promise<ToolApproval>;


}

// ─────────────────────────────────────────────────────────────────────────────
// 共享类型 / Token
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentSubNode {
  id: string;
  desc: string;
}

/**
 * 创建子 Agent 的工厂函数
 * 由调用方（如 AgentFactory）传入，封装 userInfo 等上下文，
 * 使编排 Agent 无需关心具体的 Agent 创建细节。
 */
export type CreateAgentFn = (agentName: string, container: ServiceContainer) => Promise<AgentServiceBase>;

export const T_CreateAgent = Symbol("scorpio:T_CreateAgent");
export const T_SummaryModelService = Symbol("scorpio:T_SummaryModelService");

// ─────────────────────────────────────────────────────────────────────────────
// AgentServiceBase
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Agent 服务基类
 * 仅保留所有 Agent 共用的最小状态：saver、memory、logger 和系统提示词管理。
 * 模型、技能、工具等 SingleAgent 专属逻辑由 SingleAgentService 自行持有。
 */
export interface ICancellationToken {
    readonly isCancelled: boolean;
}

export class AgentCancelledError extends Error {
    constructor() {
        super('Agent execution cancelled');
        this.name = 'AgentCancelledError';
    }
}

export abstract class AgentServiceBase {
    abstract stream(query: string, callback: IAgentCallback, cancellationToken?: ICancellationToken): Promise<ChatMessage[]>;
    protected saverService: IAgentSaverService;
    protected memoryServices: IMemoryService[];
    protected loggerService?: ILoggerService;
    protected logger?: ILogger;

    constructor(
        loggerService?: ILoggerService,
        agentSaver?: IAgentSaverService,
        memoryServices?: IMemoryService[],
    ) {
        this.saverService = agentSaver ?? new AgentMemorySaver();
        this.memoryServices = memoryServices ?? [];
        this.loggerService = loggerService;
        this.logger = loggerService?.getLogger(this.constructor.name);
    }

    /**
     * 在构造后追加系统提示词（子类按需 override；编排 Agent 调用子 Agent 时使用）
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    addSystemPrompts(_prompts: string[]): void {}

    /**
     * 以无回调方式调用 stream，返回 stream 的结果消息列表。
     */
    invoke(query: string, cancellationToken?: ICancellationToken): Promise<ChatMessage[]> {
        return this.stream(query, {}, cancellationToken);
    }

    /**
     * 释放资源
     */
    async dispose() {
        await this.saverService.dispose();
        await Promise.all(this.memoryServices.map(m => m.dispose()));
    }

}
