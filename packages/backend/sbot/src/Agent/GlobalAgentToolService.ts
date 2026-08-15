import { AgentToolService, GlobalLoggerService } from "scorpio.ai";
import { config } from "../Core/Config.js";
import { loadPrompt } from "../Core/PromptLoader.js";

export enum BuiltinProvider {
    Command = 'builtin_command',
    FileSystem = 'builtin_filesystem',
    WebFetch = 'builtin_webfetch',
    Archive = 'builtin_archive',

    SessionSearch = 'builtin_session_search',
    Channel = 'builtin_channel',

    Exa = 'builtin_exa',
}

export const globalAgentToolService = new AgentToolService(GlobalLoggerService.getLoggerService());

export async function createBuiltinCommandTools(processOwner?: string) {
    const { createCommandTools } = await import("scorpio.tools.command");
    return createCommandTools({
        descriptions: {
            shell: loadPrompt('tools/command/shell.txt'),
            readProcess: loadPrompt('tools/command/read_process.txt'),
            writeProcess: loadPrompt('tools/command/write_process.txt'),
            pythonCode: loadPrompt('tools/command/python_code.txt'),
            powerShellCode: {
                pwsh: loadPrompt('tools/command/ps_code_pwsh.txt'),
                powershell: loadPrompt('tools/command/ps_code_powershell.txt'),
            },
        },
        logger: GlobalLoggerService.getLogger('Tools/Command'),
        processOwner,
    });
}

export function initGlobalAgentToolService() {
    globalAgentToolService.registerToolFactory(BuiltinProvider.Command, async (_params) => {
        return createBuiltinCommandTools();
    }, '命令执行');
    globalAgentToolService.registerToolFactory(BuiltinProvider.FileSystem, async (params) => {
        const { createFileSystemTools } = await import("scorpio.tools.filesystem");
        return createFileSystemTools({
            readonly: params?.readonly,
            descriptions: {
                read: loadPrompt('tools/fs/read.txt'),
                readMediaFile: loadPrompt('tools/fs/read_media_file.txt'),
                write: loadPrompt('tools/fs/write.txt'),
                edit: loadPrompt('tools/fs/edit.txt'),
                grep: loadPrompt('tools/fs/grep.txt'),
                glob: loadPrompt('tools/fs/glob.txt'),
                ls: loadPrompt('tools/fs/ls.txt'),
                rm: loadPrompt('tools/fs/rm.txt'),
                mkdir: loadPrompt('tools/fs/mkdir.txt'),
                move: loadPrompt('tools/fs/move.txt'),
            },
            logger: GlobalLoggerService.getLogger('Tools/FileSystem'),
        });
    }, '文件系统操作');
    globalAgentToolService.registerToolFactory(BuiltinProvider.WebFetch, async (_params) => {
        const { createWebFetchTools } = await import("../Tools/Web/index.js");
        return createWebFetchTools();
    }, 'Web 内容抓取');
    globalAgentToolService.registerToolFactory(BuiltinProvider.Archive, async (_params) => {
        const { createArchiveTools } = await import("../Tools/Archive/index.js");
        return createArchiveTools();
    }, 'ZIP 压缩/解压');
    globalAgentToolService.registerToolFactory(BuiltinProvider.SessionSearch, async (_params) => {
        const { createSessionSearchTool } = await import("../Tools/SessionSearch/index.js");
        return [createSessionSearchTool(null)];
    }, '历史会话全文搜索');
    // Channel 在全局服务里只用 preview 占位（无 currentChannelId）注册，仅供 admin 展示工具 schema；
    // 实际运行时会被 AgentFactory.SESSION_TOOL_CREATORS 用真 channelId 单独注册到 per-agent 的 ToolService 上。
    globalAgentToolService.registerToolFactory(BuiltinProvider.Channel, async (_params) => {
        const { createChannelTools } = await import("../Tools/Channel/index.js");
        return createChannelTools();
    }, '查询/发消息/发文件 跨 channel 会话');
    globalAgentToolService.registerMcpServers({
        [BuiltinProvider.Exa]: {
            "type": "http",
            "url": "https://mcp.exa.ai/mcp",
            "description": "Exa 网络搜索",
        },
    })
    globalAgentToolService.registerMcpServers(config.getGlobalMcpServers());
}

export function refreshGlobalAgentToolService() {
    globalAgentToolService.reset();
    initGlobalAgentToolService()
}

export function refreshBuiltinTools() {
    globalAgentToolService.resetProviders(
        BuiltinProvider.Command,
        BuiltinProvider.FileSystem,
        BuiltinProvider.WebFetch,
        BuiltinProvider.Archive,
    );
}
