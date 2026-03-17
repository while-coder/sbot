import { StructuredToolInterface } from "@langchain/core/tools";
import { IAgentToolService } from "./IAgentToolService";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { MCPServers } from "./MCPServerConfig";
import { ILoggerService } from "../Logger";
import { inject } from "../Core";

/**
 * Agent 工具服务基础实现
 * 负责工具的加载和管理
 */
export class AgentToolService implements IAgentToolService {
    private loadingPromise?: Promise<void>;
    private toolsMap: Map<string, StructuredToolInterface[]> = new Map();
    private toolProviders: Map<string, { factory: () => Promise<StructuredToolInterface[]>; description?: string }> = new Map();
    private logger;

    constructor(
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
    ) {
        this.logger = loggerService?.getLogger("AgentToolService");
    }

    /**
     * 注册工具工厂函数
     * @param name 工厂名称，相同名称会覆盖已有注册
     * @param factory 工具工厂函数，返回工具数组
     */
    registerToolFactory(name: string, factory: () => Promise<StructuredToolInterface[]>, description?: string): void {
        this.toolProviders.set(name, { factory, description });
        this.loadingPromise = undefined;
    }

    /**
     * 注册 MCP 服务器工具（每个 server 包装为 provider，延迟到 getTools 时初始化）
     * @param mcpServers MCP 服务器配置对象
     */
    registerMcpServers(mcpServers: MCPServers): void {
        if (Object.keys(mcpServers).length === 0) return;
        for (const [name, cfg] of Object.entries(mcpServers)) {
            this.toolProviders.set(name, {
                factory: async () => {
                    const client = new MultiServerMCPClient({ mcpServers: { [name]: cfg } });
                    return await client.getTools();
                },
                description: cfg.description,
            });
        }
        this.loadingPromise = undefined;
    }

    private addToolToProvider(providerName: string, tool: StructuredToolInterface) {
        const list = this.toolsMap.get(providerName) ?? [];
        if (list.findIndex(x => x.name === tool.name) < 0) {
            list.push(tool);
        }
        this.toolsMap.set(providerName, list);
    }

    /**
     * 获取所有可用工具（首次调用时加载，并发调用共享同一次加载）
     */
    async getAllTools(): Promise<StructuredToolInterface[]> {
        if (!this.loadingPromise) {
            this.loadingPromise = this.loadTools();
        }
        await this.loadingPromise;
        return this.flattenTools();
    }

    private async loadTools(): Promise<void> {
        this.toolsMap.clear();

        for (const [name, provider] of this.toolProviders) {
            try {
                const tools = await provider.factory();
                for (const tool of tools) {
                    this.addToolToProvider(name, tool);
                }
            } catch (error: any) {
                this.logger?.error(`Failed to load tools from provider "${name}": ${error.message}`);
            }
        }
    }

    /**
     * 按 provider 名称过滤，返回指定 provider 的工具集合
     * @param providerNames 要查询的 provider 名称列表
     */
    async getToolsFrom(providerNames: string[]): Promise<StructuredToolInterface[]> {
        await this.getAllTools();
        const nameSet = new Set(providerNames);
        const result: StructuredToolInterface[] = [];
        for (const [name, tools] of this.toolsMap) {
            if (nameSet.has(name)) {
                result.push(...tools);
            }
        }
        return result;
    }

    /**
     * 获取所有已注册的 provider 名称
     */
    getProviderNames(): string[] {
        return Array.from(this.toolProviders.keys());
    }

    getProviderDescription(name: string): string | undefined {
        return this.toolProviders.get(name)?.description;
    }

    /**
     * 重置工具加载状态（用于测试或重新加载）
     */
    reset(): void {
        this.loadingPromise = undefined;
        this.toolsMap.clear();
        this.toolProviders.clear();
    }

    private flattenTools(): StructuredToolInterface[] {
        const result: StructuredToolInterface[] = [];
        for (const tools of this.toolsMap.values()) {
            result.push(...tools);
        }
        return result;
    }
}
