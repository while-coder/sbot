import { saverProviderRegistry, type SaverProviderRegistry } from "scorpio.saver";
import { AgentFileSaver } from "./AgentFileSaver";

export const FILE_SAVER_TYPE = "file";

export function registerFileSaverProvider(registry: SaverProviderRegistry = saverProviderRegistry): void {
    registry.register({
        type: FILE_SAVER_TYPE,
        label: "File",
        pooled: true,
        fileExtension: ".json",
        create: ({ storagePath, loggerService }) => {
            if (!storagePath) throw new Error("File saver requires a storage path");
            return new AgentFileSaver(storagePath, loggerService);
        },
    });
}

export { AgentFileSaver } from "./AgentFileSaver";
