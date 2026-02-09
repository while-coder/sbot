import { StructuredToolInterface } from "@langchain/core/tools";

/**
 * Agent 工具服务接口
 * 负责工具的加载和管理
 */
export interface IAgentToolService {
    /**
     * 获取所有可用工具（首次调用时加载）
     */
    getTools(): Promise<StructuredToolInterface[]>;

    /**
     * 判断工具是否需要人工审批
     */
    isDisabledAutoApprove(toolName: string): boolean;
}

/**
 * IAgentToolService 的依赖注入标识符
 */
export const IAgentToolService = Symbol.for("IAgentToolService");
