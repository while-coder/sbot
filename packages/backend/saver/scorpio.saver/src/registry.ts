import { AgentMemorySaver } from "./AgentMemorySaver";
import type { IAgentSaverService } from "./IAgentSaverService";

export interface SaverLogger {
    debug(message: string): void;
    info(message: string): void;
    warn(message: string): void;
    error(message: string): void;
}

export interface SaverLoggerService {
    getLogger(name: string): SaverLogger;
}

export interface SaverCreateContext {
    saverId: string;
    threadId: string;
    storagePath?: string;
    config: Record<string, unknown>;
    loggerService?: SaverLoggerService;
}

export interface SaverProviderDefinition {
    type: string;
    label: string;
    pooled: boolean;
    fileExtension?: string;
    create(context: SaverCreateContext): IAgentSaverService | Promise<IAgentSaverService>;
    getPoolKey?(context: SaverCreateContext): string;
}

export interface SaverProviderMetadata {
    type: string;
    label: string;
    pooled: boolean;
    fileExtension?: string;
}

export class SaverProviderRegistry {
    private readonly providers = new Map<string, SaverProviderDefinition>();

    register(definition: SaverProviderDefinition): void {
        if (this.providers.has(definition.type)) {
            throw new Error(`Saver provider already registered: ${definition.type}`);
        }
        this.providers.set(definition.type, definition);
    }

    get(type: string): SaverProviderDefinition | undefined {
        return this.providers.get(type);
    }

    list(): SaverProviderMetadata[] {
        return [...this.providers.values()].map(({ type, label, pooled, fileExtension }) => ({
            type,
            label,
            pooled,
            fileExtension,
        }));
    }
}

export const saverProviderRegistry = new SaverProviderRegistry();

export function registerMemorySaverProvider(registry = saverProviderRegistry): void {
    registry.register({
        type: "memory",
        label: "Memory",
        pooled: false,
        create: () => new AgentMemorySaver(),
    });
}

export function formatSaverError(error: unknown, includeStack = false): string {
    if (error instanceof Error) {
        return includeStack && error.stack ? error.stack : error.message;
    }
    return String(error);
}
