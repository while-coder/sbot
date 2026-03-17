import { StructuredToolInterface } from "@langchain/core/tools";
import { AgentToolCall } from "../Agents";

/**
 * Agent 工具服务接口
 * 负责工具的加载和管理
 */
export interface IAgentToolService {
    /**
     * 获取所有可用工具（首次调用时加载）
     */
    getAllTools(): Promise<StructuredToolInterface[]>;

    /**
     * 按 provider 名称过滤，返回指定 provider 的工具集合
     */
    getToolsFrom(providerNames: string[]): Promise<StructuredToolInterface[]>;

    /**
     * 获取所有已注册的 provider 名称
     */
    getProviderNames(): string[];

    /**
     * 获取指定 provider 的描述
     */
    getProviderDescription(name: string): string | undefined;

    /**
     * 判断工具是否自动审批（无需人工确认）
     */
    isAutoApprove(toolCall: AgentToolCall): boolean;

    /**
     * 将工具加入自动审批名单
     * @param name 工具名称
     * @param args '*' 表示所有参数，否则传 JSON.stringify(args)
     */
    addAutoApproveTools(name: string, args: string): void;
}

/**
 * IAgentToolService 的依赖注入 token
 * 使用 Symbol 确保唯一性，避免命名冲突
 */
export const IAgentToolService = Symbol("IAgentToolService");
