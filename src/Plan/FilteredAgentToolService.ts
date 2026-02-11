import { StructuredToolInterface } from "@langchain/core/tools";
import { IAgentToolService } from "scorpio.ai";
import { LoggerService } from "../LoggerService.js";

const logger = LoggerService.getLogger("FilteredAgentToolService.ts");

/**
 * 过滤工具服务
 * 包装父级 IAgentToolService，为特定 Sub-Agent 提供受限的工具集
 * 
 * 注意：skillService 和 memoryService 的工具由 AgentService.callModelNode() 内部处理，
 * 无需在此注册。只需通过 subContainer.registerInstance 注入即可。
 */
export class FilteredAgentToolService implements IAgentToolService {
  private parentToolService: IAgentToolService;
  private allowedTools: Set<string>;
  private allowAll: boolean;

  constructor(
    allowedTools: string[],
    parentToolService: IAgentToolService
  ) {
    this.allowedTools = new Set(allowedTools);
    this.allowAll = this.allowedTools.has("*");
    this.parentToolService = parentToolService;

    if (this.allowAll) {
      logger.info("FilteredAgentToolService: 允许所有工具");
    } else {
      logger.info(`FilteredAgentToolService: 允许工具列表 - ${Array.from(this.allowedTools).join(', ')}`);
    }
  }

  /**
   * 获取过滤后的工具列表
   */
  async getTools(): Promise<StructuredToolInterface[]> {
    const allTools = await this.parentToolService.getTools();

    // 如果允许所有工具，直接返回
    if (this.allowAll) {
      return allTools;
    }

    // 过滤只返回允许的工具
    const filteredTools = allTools.filter(tool => this.allowedTools.has(tool.name));

    logger.info(`FilteredAgentToolService: 过滤后工具数量 ${filteredTools.length}/${allTools.length}`);

    return filteredTools;
  }

  /**
   * 判断工具是否需要人工审批
   */
  isDisabledAutoApprove(toolName: string): boolean {
    // 如果工具不在允许列表中，返回 false（不会执行）
    if (!this.allowAll && !this.allowedTools.has(toolName)) {
      return false;
    }
    return this.parentToolService.isDisabledAutoApprove(toolName);
  }
}
