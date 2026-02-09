import { StructuredToolInterface } from "@langchain/core/tools";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { config } from "../Config";
import { LoggerService } from "../LoggerService";
import { ISkillService } from "../Skills";
import { IMemoryService } from "../Memory";
import { createFileSystemTools } from "../Tools/FileSystem";
import { createSkillTools } from "../Tools/Skills";
import { createCommandTools } from "../Tools/Command";
import { createMemoryTools } from "../Tools/Memory";
import { IAgentToolService } from "./IAgentToolService";
import { inject } from "../Core";

const logger = LoggerService.getLogger("AgentToolService.ts");

/**
 * Agent 工具服务
 * 负责工具的加载和管理
 */
export class AgentToolService implements IAgentToolService {
    private tools: StructuredToolInterface[] = [];
    private disabledAutoApproveTools = new Set<string>();
    private loaded = false;

    constructor(
        @inject(ISkillService, { optional: true }) private skillService?: ISkillService,
        @inject(IMemoryService, { optional: true }) private memoryService?: IMemoryService,
    ) {}

    /**
     * 获取所有可用工具（首次调用时加载）
     */
    async getTools(): Promise<StructuredToolInterface[]> {
        if (this.loaded) return this.tools;

        this.tools = [];
        this.disabledAutoApproveTools = new Set<string>();

        // 文件系统工具
        this.tools.push(...createFileSystemTools({ maxFileSize: 10 * 1024 * 1024 }));

        // 命令执行工具
        this.tools.push(...createCommandTools());

        // skill 工具
        if (this.skillService) {
            this.tools.push(...createSkillTools());
        }

        // 记忆工具
        if (this.memoryService) {
            this.tools.push(...createMemoryTools(this.memoryService));
        }

        // 内置 MCP 服务器
        await this.addMcpServers(config.getBuiltinMcpServers());

        // 用户配置的 MCP 服务器
        const mcpServers = config.getMcpServers();
        if (mcpServers) {
            await this.addMcpServers(mcpServers);
        }

        this.loaded = true;
        return this.tools;
    }

    /**
     * 判断工具是否需要人工审批
     */
    isDisabledAutoApprove(toolName: string): boolean {
        return this.disabledAutoApproveTools.has(toolName);
    }

    /**
     * 添加 MCP 服务器工具
     */
    private async addMcpServers(mcpServers: any) {
        if (Object.keys(mcpServers).length === 0) return;

        // 收集被禁用的工具名称
        const disabledTools = new Set<string>();

        for (const key in mcpServers) {
            if (mcpServers[key]?.disabledAutoApproveTools != null) {
                mcpServers[key].disabledAutoApproveTools.forEach((tool: string) => {
                    this.disabledAutoApproveTools.add(tool);
                });
            }

            if (mcpServers[key]?.disabled != null) {
                mcpServers[key].disabled.forEach((tool: string) => {
                    disabledTools.add(tool);
                });
            }
        }

        const mcpClient = new MultiServerMCPClient({ mcpServers });
        const tools = await mcpClient.getTools();

        for (const tool of tools) {
            if (!disabledTools.has(tool.name) && this.tools.findIndex(x => x.name === tool.name) < 0) {
                this.tools.push(tool);
            }
        }
    }
}
