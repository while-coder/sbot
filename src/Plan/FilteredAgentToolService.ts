import { StructuredToolInterface } from "@langchain/core/tools";
import { IAgentToolService, AgentToolService, ISkillService, IMemoryService } from "scorpio.ai";
import { LoggerService } from "../LoggerService.js";

const logger = LoggerService.getLogger("FilteredAgentToolService.ts");

/**
 * 过滤工具服务
 * 为特定 Agent 提供受限的工具集
 */
export class FilteredAgentToolService implements IAgentToolService {
  private baseToolService: AgentToolService;
  private allowedTools: Set<string>;
  private allowAll: boolean;

  constructor(
    allowedTools: string[],
    skillService?: ISkillService,
    memoryService?: IMemoryService
  ) {
    this.allowedTools = new Set(allowedTools);
    this.allowAll = this.allowedTools.has("*");
    this.baseToolService = new AgentToolService();

    if (skillService || memoryService) {
      // 注册工具工厂
      // 注意：这里需要手动添加工具，因为 AgentToolService 在 scorpio.ai 中是基础实现
      logger.warn("FilteredAgentToolService: skillService 和 memoryService 需要通过 registerToolFactory 注册");
    }

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
    const allTools = await this.baseToolService.getTools();

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
    return this.baseToolService.isDisabledAutoApprove(toolName);
  }
}
