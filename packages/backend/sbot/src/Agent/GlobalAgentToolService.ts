import { AgentToolService, GlobalLoggerService } from "scorpio.ai";
import { createExecCommandTool, setCommandLogger } from "scorpio.command";
import { config } from "../Core/Config.js";
import { loadPrompt } from "../Core/PromptLoader.js";

export enum BuiltinProvider {
    Command = 'builtin_command',
}

export const globalAgentToolService = new AgentToolService(GlobalLoggerService.getLoggerService());

export async function createBuiltinCommandTools(processOwner?: string, workdir?: string) {
    setCommandLogger(GlobalLoggerService.getLogger('Tools/Command'));
    return [createExecCommandTool({
        description: loadPrompt('tools/command/exec_command.txt'),
        processOwner,
        workdir,
    })];
}

export function initGlobalAgentToolService() {
    globalAgentToolService.registerToolFactory(BuiltinProvider.Command, () => createBuiltinCommandTools(), '命令执行');
    globalAgentToolService.registerMcpServers(config.getGlobalMcpServers());
}

export function refreshGlobalAgentToolService() {
    globalAgentToolService.reset();
    initGlobalAgentToolService();
}

export function refreshBuiltinTools() {
    globalAgentToolService.resetProviders(BuiltinProvider.Command);
}
