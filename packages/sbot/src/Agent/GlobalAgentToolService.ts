import { AgentToolService, GlobalLoggerService } from "scorpio.ai";
import { config } from "../Core/Config.js";
import { createCommandTools } from "../Tools/Command/index.js";
import { createFileSystemTools } from "../Tools/FileSystem/index.js";
import { createWebFetchTools } from "../Tools/Web/index.js";
import { createArchiveTools } from '../Tools/Archive/index.js';
import { createGameDataTools } from '../Tools/GameData/index.js';

export enum BuiltinProvider {
    Command = 'builtin_command',
    FileSystem = 'builtin_filesystem',
    WebFetch = 'builtin_webfetch',
    Archive = 'builtin_archive',

    Playwright = 'builtin_playwright',
    ChromeDevTools = 'builtin_chrome-devtools-mcp',
    Markitdown = 'builtin_markitdown',
    Exa = 'builtin_exa',
    GameData = 'builtin_gamedata'
}

export const globalAgentToolService = new AgentToolService(GlobalLoggerService.getLoggerService());

export function initGlobalAgentToolService() {
    globalAgentToolService.registerToolFactory(BuiltinProvider.Command, async () => createCommandTools(), '命令执行');
    globalAgentToolService.registerToolFactory(BuiltinProvider.FileSystem, async () => createFileSystemTools(), '文件系统操作');
    globalAgentToolService.registerToolFactory(BuiltinProvider.WebFetch, async () => createWebFetchTools(), 'Web 内容抓取');
    globalAgentToolService.registerToolFactory(BuiltinProvider.Archive, async () => createArchiveTools(), 'ZIP 压缩/解压');
    // globalAgentToolService.registerToolFactory(BuiltinProvider.GameData, async () => createGameDataTools(), '游戏数据表查询与修改');
    globalAgentToolService.registerMcpServers({
        [BuiltinProvider.Playwright]: {
            "command": "npx.cmd",
            "args": ["@playwright/mcp@latest"],
            "description": "Playwright 浏览器自动化",
        },
        [BuiltinProvider.ChromeDevTools]: {
            "type": "stdio",
            "command": "npx",
            "args": ["-y", "chrome-devtools-mcp@latest"],
            "description": "Chrome DevTools 调试",
        },
        [BuiltinProvider.Markitdown]: {
            "type": "stdio",
            "command": "uvx",
            "args": ["markitdown-mcp@0.0.1a4"],
            "description": "文档转 Markdown",
        },
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

export async function refreshBuiltinTools() {
    await globalAgentToolService.reloadProviders(
        BuiltinProvider.Command,
        BuiltinProvider.FileSystem,
        BuiltinProvider.WebFetch,
        BuiltinProvider.Archive,
        BuiltinProvider.GameData,
    );
}
