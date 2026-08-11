import { StructuredToolInterface } from "@langchain/core/tools";
import type { ProviderResult } from "./MCPTypes";

export interface ProviderResolveEntry {
    name: string;
    params?: Record<string, any>;
}

export interface IAgentToolService {
    getAllTools(): Promise<StructuredToolInterface[]>;
    getAllProviderResults(): Promise<Map<string, ProviderResult>>;
    getProviderResultsByName(providerNames: string[]): Promise<Map<string, ProviderResult>>;
    resolveProviders(entries: ProviderResolveEntry[]): Promise<Map<string, ProviderResult>>;
    getProviderNames(): string[];
    getProviderDescription(name: string): string | undefined;
}

/**
 * IAgentToolService 的依赖注入 token
 * 使用 Symbol 确保唯一性，避免命名冲突
 */
export const IAgentToolService = Symbol("IAgentToolService");
