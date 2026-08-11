import { saverProviderRegistry, type SaverProviderRegistry } from "scorpio.saver";
import { AgentSqliteSaver } from "./AgentSqliteSaver";

export const SQLITE_SAVER_TYPE = "sqlite";

export function registerSqliteSaverProvider(registry: SaverProviderRegistry = saverProviderRegistry): void {
    registry.register({
        type: SQLITE_SAVER_TYPE,
        label: "SQLite",
        pooled: true,
        fileExtension: ".db",
        create: ({ storagePath, loggerService }) => {
            if (!storagePath) throw new Error("SQLite saver requires a storage path");
            return new AgentSqliteSaver(storagePath, loggerService);
        },
    });
}

export { AgentSqliteSaver } from "./AgentSqliteSaver";
