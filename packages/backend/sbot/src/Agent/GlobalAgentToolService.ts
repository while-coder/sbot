import { AgentToolService, GlobalLoggerService, MCPTransport, createAgentTool, createErrorResult, createSuccessResult, formatError, readWorkspaceImage } from "scorpio.ai";
import { createExecCommandTool, createWriteStdinTool, setCommandLogger } from "scorpio.command";
import { z } from "zod";
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
        createAgentTool({
            name: 'view_image',
            description: 'Load a local image into the model for visual inspection. Use a path relative to the current session workspace.',
            schema: z.object({ path: z.string().trim().min(1) }),
            async func({ path }) {
                try {
                    return createSuccessResult(await readWorkspaceImage(workdir, path));
                } catch (error) {
                    return createErrorResult(`Could not view "${path}": ${formatError(error)}`);
                }
            },
        }),
    ];
}

export function initGlobalAgentToolService() {
    globalAgentToolService.registerMcpServers(config.getGlobalMcpServers());
    globalAgentToolService.registerToolFactory(BuiltinProvider.Command, () => createBuiltinCommandTools(), '命令执行、文件补丁与图片查看');
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
