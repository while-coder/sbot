import { BaseMessage } from "langchain";
import { ServiceContainer } from "../DI";
import { IMemoryService } from "../Memory";
import { IAgentSaverService, AgentMemorySaver } from "../Saver";
import { ILoggerService, ILogger } from "../Logger";
import { MCPToolResult } from '../Tools';

export const MAX_HISTORY_TOKENS = 150_000;

// ─────────────────────────────────────────────────────────────────────────────
// 公共类型定义
// ─────────────────────────────────────────────────────────────────────────────

export enum MessageChunkType {
    AI = "ai",
    TOOL = "tool",
    COMMAND = "command",
}

export enum GraphNodeType {
    AGENT = "agent",
    TOOLS = "tools",
}

export type AgentToolCall = {
    id?: string;
    name: string;
    args: Record<string, any>;
};

export type AgentMessage = {
    type: MessageChunkType;
    content?: string;
    tool_calls?: AgentToolCall[];
    tool_call_id?: string;
    status?: string;
};

/**
 * Agent 回调接口 - 统一管理消息、流式、工具确认和图片转换回调
 */
export interface IAgentCallback {
    /**
     * 接收完整的消息（在节点输出完成后触发）
     */
    onMessage?(message: AgentMessage): Promise<void>;

    /**
     * 接收实时的流式消息块（在模型生成过程中触发）
     */
    onStreamMessage?(message: AgentMessage): Promise<void>;

    /**
     * 工具执行前进行确认
     * @returns true 表示允许执行，false 表示拒绝执行
     */
    executeTool?(toolCall: AgentToolCall): Promise<boolean>;

    /**
     * 转换工具返回内容中的图片链接
     */
    convertImages?(result: MCPToolResult): Promise<MCPToolResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// 共享类型 / Token
// ─────────────────────────────────────────────────────────────────────────────

export interface AgentSubNode {
  id: string;
  name: string;
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
export abstract class AgentServiceBase {
    abstract stream(query: string, callback: IAgentCallback): Promise<BaseMessage[]>;
    protected saverService: IAgentSaverService;
    protected memoryService?: IMemoryService;
    protected loggerService?: ILoggerService;
    protected logger?: ILogger;

    constructor(
        loggerService?: ILoggerService,
        agentSaver?: IAgentSaverService,
        memoryService?: IMemoryService,
    ) {
        this.saverService = agentSaver ?? new AgentMemorySaver();
        this.memoryService = memoryService;
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
    invoke(query: string): Promise<BaseMessage[]> {
        return this.stream(query, {});
    }

    /**
     * 释放资源
     */
    async dispose() {
        await this.saverService.dispose();
        await this.memoryService?.dispose();
    }

    /**
     * 将 BaseMessage 转换为 AgentMessage 格式
     */
    protected convertToMessageChunk(message: BaseMessage): AgentMessage | null {
        const name = message.constructor.name;
        const m = message as any;
        if (name === 'AIMessage' || name === 'AIMessageChunk') {
            const toolCalls: AgentToolCall[] = (m.tool_calls || []).map((tc: any) => ({
                id: tc.id || "",
                name: tc.name,
                args: tc.args
            }));
            return {
                type: MessageChunkType.AI,
                content: m.text as string,
                tool_calls: toolCalls
            };
        } else if (name === 'ToolMessage') {
            return {
                type: MessageChunkType.TOOL,
                tool_call_id: m.tool_call_id || "",
                status: m.status,
                content: (m.content as string).trim()
            };
        } else {
            this.logger?.warn(`未知AI消息类型: ${name}`);
        }
        return null;
    }
}
