import { saverProviderRegistry, type SaverProviderRegistry } from "scorpio.saver";
import { AgentPostgresSaver } from "./AgentPostgresSaver";

export const POSTGRES_SAVER_TYPE = "postgres";

function requireString(config: Record<string, unknown>, key: string): string {
    const value = config[key];
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`PostgreSQL saver requires config.${key}`);
    }
    return value;
}

export function registerPostgresSaverProvider(registry: SaverProviderRegistry = saverProviderRegistry): void {
    registry.register({
        type: POSTGRES_SAVER_TYPE,
        label: "PostgreSQL",
        pooled: true,
        create: ({ config, loggerService }) => new AgentPostgresSaver(
            requireString(config, "table"),
            requireString(config, "connectionString"),
            loggerService,
        ),
    });
}

export { AgentPostgresSaver } from "./AgentPostgresSaver";
