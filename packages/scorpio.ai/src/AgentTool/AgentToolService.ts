import { StructuredToolInterface } from "@langchain/core/tools";
import { IAgentToolService, type ProviderResolveEntry } from "./IAgentToolService";
import { MCPServers } from "./MCPServerConfig";
import { ILoggerService } from "../Logger";
import { inject } from "../Core";
import type { MCPPrompt, MCPPromptMessage, MCPResource, MCPResourceTemplate, ProviderResult } from "./MCPTypes";
import { RecoverableMcpClient } from "./RecoverableMcpClient";

interface ProviderEntry {
    factory: (params?: Record<string, any>) => Promise<ProviderResult>;
    description?: string;
}

function cacheKey(name: string, params?: Record<string, any>): string {
    if (params === undefined) return name;
    return `${name}::${JSON.stringify(params)}`;
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

    registerToolFactory(name: string, factory: (params?: Record<string, any>) => Promise<StructuredToolInterface[]>, description?: string): void {
        this.providers.set(name, {
            factory: async (params) => ({ tools: await factory(params) }),
            description,
        });
        this.invalidate(name);
    }

    registerMcpServers(mcpServers: MCPServers): void {
        if (Object.keys(mcpServers).length === 0) return;
        for (const [name, cfg] of Object.entries(mcpServers)) {
            this.providers.set(name, {
                factory: async () => {
                    const client = new RecoverableMcpClient(name, cfg, this.logger);
                    const tools = await client.getTools();

                    let prompts: MCPPrompt[] | undefined;
                    let resources: MCPResource[] | undefined;
                    let resourceTemplates: MCPResourceTemplate[] | undefined;

                    try {
                        prompts = await client.runOperation(async (c) => {
                            const rc = await c.getClient(name);
                            if (!rc) return undefined as MCPPrompt[] | undefined;
                            return (await rc.listPrompts()).prompts as MCPPrompt[];
                        });
                    } catch {}
                    try {
                        resources = await client.runOperation(async (c) => (await c.listResources(name))[name]);
                    } catch {}
                    try {
                        resourceTemplates = await client.runOperation(async (c) => (await c.listResourceTemplates(name))[name]);
                    } catch {}

                    return {
                        tools, prompts, resources, resourceTemplates,
                        getPrompt: async (promptName: string, args?: Record<string, string>) => {
                            return client.runOperation(async (c) => {
                                const rc = await c.getClient(name);
                                if (!rc) throw new Error(`MCP client for "${name}" not available`);
                                const result = await rc.getPrompt({ name: promptName, arguments: args });
                                return result.messages as MCPPromptMessage[];
                            });
                        },
                        readResource: async (uri: string) => {
                            return client.runOperation(async (c) => c.readResource(name, uri));
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
        return this.resolveProviders(providerNames.map(name => ({ name })));
    }

    async resolveProviders(entries: ProviderResolveEntry[]): Promise<Map<string, ProviderResult>> {
        await Promise.all(entries.map(e => this.loadProvider(e.name, e.params)));
        const result = new Map<string, ProviderResult>();
        for (const e of entries) {
            const caps = this.providerResults.get(cacheKey(e.name, e.params));
            if (caps) result.set(e.name, caps);
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
        for (const k of [...this.providerResults.keys()]) {
            if (k === name || k.startsWith(`${name}::`)) {
                this.providerResults.get(k)?.close?.().catch(() => {});
                this.providerResults.delete(k);
            }
        }
        for (const k of [...this.loadingPromises.keys()]) {
            if (k === name || k.startsWith(`${name}::`)) {
                this.loadingPromises.delete(k);
            }
        }
    }

    private loadProvider(name: string, params?: Record<string, any>): Promise<void> {
        const key = cacheKey(name, params);
        if (this.providerResults.has(key)) return Promise.resolve();
        if (this.loadingPromises.has(key)) return this.loadingPromises.get(key)!;
        const provider = this.providers.get(name);
        if (!provider) return Promise.resolve();

        const promise = provider.factory(params).then(caps => {
            if (this.loadingPromises.get(key) !== promise) return;
            this.providerResults.set(key, caps);
        }).catch((error: any) => {
            if (this.loadingPromises.get(key) !== promise) return;
            this.loadingPromises.delete(key);
            this.logger?.error(`Failed to load provider "${name}": ${error.message}`);
        });

        this.loadingPromises.set(key, promise);
        return promise;
    }

    private async loadAll(): Promise<void> {
        await Promise.all(Array.from(this.providers.keys()).map(n => this.loadProvider(n)));
    }
}
