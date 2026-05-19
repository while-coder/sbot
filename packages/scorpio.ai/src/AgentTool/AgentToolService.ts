import { StructuredToolInterface } from "@langchain/core/tools";
import { IAgentToolService } from "./IAgentToolService";
import { MultiServerMCPClient } from "@langchain/mcp-adapters";
import { MCPServers } from "./MCPServerConfig";
import { ILoggerService } from "../Logger";
import { inject } from "../Core";
import type { MCPPrompt, MCPPromptMessage, MCPResource, MCPResourceTemplate, ProviderResult } from "./MCPTypes";

interface ProviderEntry {
    factory: () => Promise<ProviderResult>;
    description?: string;
}

export class AgentToolService implements IAgentToolService {
    private providerResults: Map<string, ProviderResult> = new Map();
    private providers: Map<string, ProviderEntry> = new Map();
    private loadingPromises: Map<string, Promise<void>> = new Map();
    private logger;

    constructor(
        @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
    ) {
        this.logger = loggerService?.getLogger("AgentToolService");
    }

    registerToolFactory(name: string, factory: () => Promise<StructuredToolInterface[]>, description?: string): void {
        this.providers.set(name, {
            factory: async () => ({ tools: await factory() }),
            description,
        });
        this.invalidate(name);
    }

    registerMcpServers(mcpServers: MCPServers): void {
        if (Object.keys(mcpServers).length === 0) return;
        for (const [name, cfg] of Object.entries(mcpServers)) {
            this.providers.set(name, {
                factory: async () => {
                    const client = new MultiServerMCPClient({ mcpServers: { [name]: cfg } });
                    const tools: StructuredToolInterface[] = [...await client.getTools()];

                    let prompts: MCPPrompt[] | undefined;
                    let resources: MCPResource[] | undefined;
                    let resourceTemplates: MCPResourceTemplate[] | undefined;

                    const rawClient = await client.getClient(name);
                    if (rawClient) {
                        try { prompts = (await rawClient.listPrompts()).prompts as MCPPrompt[]; } catch {}
                    }
                    try { resources = (await client.listResources(name))[name]; } catch {}
                    try { resourceTemplates = (await client.listResourceTemplates(name))[name]; } catch {}

                    return {
                        tools, prompts, resources, resourceTemplates,
                        getPrompt: async (promptName: string, args?: Record<string, string>) => {
                            const rc = await client.getClient(name);
                            if (!rc) throw new Error(`MCP client for "${name}" not available`);
                            const result = await rc.getPrompt({ name: promptName, arguments: args });
                            return result.messages as MCPPromptMessage[];
                        },
                        readResource: async (uri: string) => {
                            return await client.readResource(name, uri);
                        },
                        close: async () => { await client.close(); },
                    };
                },
                description: cfg.description,
            });
            this.invalidate(name);
        }
    }

    async getAllTools(): Promise<StructuredToolInterface[]> {
        await this.loadAll();
        const result: StructuredToolInterface[] = [];
        for (const caps of this.providerResults.values()) result.push(...caps.tools);
        return result;
    }

    async getAllProviderResults(): Promise<Map<string, ProviderResult>> {
        await this.loadAll();
        return new Map(this.providerResults);
    }

    async getProviderResultsByName(providerNames: string[]): Promise<Map<string, ProviderResult>> {
        await Promise.all(providerNames.map(name => this.loadProvider(name)));
        const result = new Map<string, ProviderResult>();
        for (const name of providerNames) {
            const caps = this.providerResults.get(name);
            if (caps) result.set(name, caps);
        }
        return result;
    }

    getProviderNames(): string[] {
        return Array.from(this.providers.keys());
    }

    getProviderDescription(name: string): string | undefined {
        return this.providers.get(name)?.description;
    }

    resetProviders(...names: string[]): void {
        for (const name of names) {
            if (!this.providers.has(name)) continue;
            this.invalidate(name);
        }
    }

    reset(): void {
        for (const caps of this.providerResults.values()) {
            caps.close?.().catch(() => {});
        }
        this.loadingPromises.clear();
        this.providerResults.clear();
        this.providers.clear();
    }

    private invalidate(name: string): void {
        this.providerResults.get(name)?.close?.().catch(() => {});
        this.providerResults.delete(name);
        this.loadingPromises.delete(name);
    }

    private loadProvider(name: string): Promise<void> {
        if (this.providerResults.has(name)) return Promise.resolve();
        if (this.loadingPromises.has(name)) return this.loadingPromises.get(name)!;
        const provider = this.providers.get(name);
        if (!provider) return Promise.resolve();

        const promise = provider.factory().then(caps => {
            if (this.loadingPromises.get(name) !== promise) return;
            this.providerResults.set(name, caps);
        }).catch((error: any) => {
            if (this.loadingPromises.get(name) !== promise) return;
            this.loadingPromises.delete(name);
            this.logger?.error(`Failed to load provider "${name}": ${error.message}`);
        });

        this.loadingPromises.set(name, promise);
        return promise;
    }

    private async loadAll(): Promise<void> {
        await Promise.all(Array.from(this.providers.keys()).map(n => this.loadProvider(n)));
    }
}
