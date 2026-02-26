import { AgentToolService } from "scorpio.ai";
import { config } from "./Config.js";
import { createCommandTools } from "./Tools/Command/index.js";
import { createFileSystemTools } from "./Tools/FileSystem/index.js";

export enum BuiltinProvider {
    Command = 'builtin_command',
    FileSystem = 'builtin_filesystem',
}

export const globalAgentToolService = new AgentToolService();

export function initGlobalAgentToolService() {
    globalAgentToolService.registerToolFactory(BuiltinProvider.Command, async () => createCommandTools());
    globalAgentToolService.registerToolFactory(BuiltinProvider.FileSystem, async () => createFileSystemTools());
    globalAgentToolService.registerMcpServers(config.getGlobalMcpServers());
}

export function refreshGlobalAgentToolService() {
    globalAgentToolService.reset();
    globalAgentToolService.registerToolFactory(BuiltinProvider.Command, async () => createCommandTools());
    globalAgentToolService.registerToolFactory(BuiltinProvider.FileSystem, async () => createFileSystemTools());
    globalAgentToolService.registerMcpServers(config.getGlobalMcpServers());
}
