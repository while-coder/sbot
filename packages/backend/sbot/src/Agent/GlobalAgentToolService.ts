import { AgentToolService, GlobalLoggerService, MCPTransport } from "scorpio.ai";
import { createExecCommandTool, createWriteStdinTool, setCommandLogger } from "scorpio.command";
import { config } from "../Core/Config.js";
import { loadPrompt } from "../Core/PromptLoader.js";
import { createApplyPatchTool } from "./ApplyPatchTool.js";

export enum BuiltinProvider {
    Command = 'builtin_command',
    Exa = 'builtin_exa',
}

export const globalAgentToolService = new AgentToolService(GlobalLoggerService.getLoggerService());

export async function createBuiltinCommandTools(processOwner?: string, workdir?: string) {
    setCommandLogger(GlobalLoggerService.getLogger('Tools/Command'));
    return [
        createExecCommandTool({ description: loadPrompt('tools/command/exec_command.txt'), processOwner, workdir }),
        createWriteStdinTool(processOwner),
        createApplyPatchTool(workdir),
    ];
}

export function initGlobalAgentToolService() {
    globalAgentToolService.registerMcpServers(config.getGlobalMcpServers());
    globalAgentToolService.registerToolFactory(BuiltinProvider.Command, () => createBuiltinCommandTools(), '命令执行与文件补丁');
    globalAgentToolService.registerMcpServers({
        [BuiltinProvider.Exa]: {
            type: MCPTransport.Http,
            url: 'https://mcp.exa.ai/mcp',
            description: 'Exa 网页搜索',
        },
    }, ['web_search_exa']);
}

export function refreshGlobalAgentToolService() {
    globalAgentToolService.reset();
    initGlobalAgentToolService();
}

export function refreshBuiltinTools() {
    globalAgentToolService.resetProviders(BuiltinProvider.Command);
}
