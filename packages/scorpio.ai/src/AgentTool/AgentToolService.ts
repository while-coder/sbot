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
    private providerLoadingPromises: Map<string, Promise<void>> = new Map();
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
        this.providerLoadingPromises.delete(name);
        this.toolsMap.delete(name);        // Bug 2: 清除旧工具缓存，避免重新注册后残留旧数据
    }

    /**
     * 注册 MCP 服务器工具（每个 server 包装为 provider，延迟到实际使用时初始化）
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
            this.providerLoadingPromises.delete(name);
            this.toolsMap.delete(name);    // Bug 2: 清除旧工具缓存
        }
    }

    private addToolToProvider(providerName: string, tool: StructuredToolInterface) {
        const list = this.toolsMap.get(providerName) ?? [];
        if (!list.some(x => x.name === tool.name)) {
            list.push(tool);
        }
        this.toolsMap.set(providerName, list);
    }

    private ensureProviderLoaded(name: string): Promise<void> {
        if (this.providerLoadingPromises.has(name)) {
            return this.providerLoadingPromises.get(name)!;
        }
        const provider = this.toolProviders.get(name);
        if (!provider) return Promise.resolve();

        const promise = provider.factory().then(tools => {
            for (const tool of tools) {
                this.addToolToProvider(name, tool);
            }
        }).catch((error: any) => {
            this.providerLoadingPromises.delete(name); // Bug 1: 失败时清除缓存，允许下次重试
            this.logger?.error(`Failed to load tools from provider "${name}": ${error.message}`);
        });

        this.providerLoadingPromises.set(name, promise);
        return promise;
    }

    /**
     * 按 provider 名称按需加载，只加载用到的 provider
     * @param providerNames 要查询的 provider 名称列表
     */
    async getToolsFrom(providerNames: string[]): Promise<StructuredToolInterface[]> {
        await Promise.all(providerNames.map(name => this.ensureProviderLoaded(name)));
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
     * 获取所有可用工具（按需并发加载所有 provider）
     */
    async getAllTools(): Promise<StructuredToolInterface[]> {
        await Promise.all(
            Array.from(this.toolProviders.keys()).map(name => this.ensureProviderLoaded(name))
        );
        return this.flattenTools();
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
     * 重新加载指定 provider 的工具（不影响其他 provider，不断开 MCP 连接）
     */
    async reloadProviders(...names: string[]): Promise<void> {
        for (const name of names) {
            if (!this.toolProviders.has(name)) continue;
            this.providerLoadingPromises.delete(name);
            this.toolsMap.delete(name);
        }
        await Promise.all(names.map(name => this.ensureProviderLoaded(name)));
    }

    /**
     * 重置工具加载状态（用于测试或重新加载）
     */
    reset(): void {
        this.providerLoadingPromises.clear();
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
