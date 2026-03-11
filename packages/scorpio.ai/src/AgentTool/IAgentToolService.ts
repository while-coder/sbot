import { StructuredToolInterface } from "@langchain/core/tools";

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
     * 判断工具是否需要人工审批
     */
    isDisabledAutoApprove(toolName: string): boolean;
}

/**
 * IAgentToolService 的依赖注入 token
 * 使用 Symbol 确保唯一性，避免命名冲突
 */
export const IAgentToolService = Symbol("IAgentToolService");
