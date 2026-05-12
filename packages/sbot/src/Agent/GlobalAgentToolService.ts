import { AgentToolService } from "scorpio.ai/AgentTool";
import { GlobalLoggerService } from "scorpio.ai/Logger";
import { config } from "../Core/Config.js";

export enum BuiltinProvider {
    Command = 'builtin_command',
    FileSystem = 'builtin_filesystem',
    WebFetch = 'builtin_webfetch',
    Archive = 'builtin_archive',
    Sleep = 'builtin_sleep',
    Time = 'builtin_time',

    Scheduler = 'builtin_scheduler',
    Todo = 'builtin_todo',

    Playwright = 'builtin_playwright',
    ChromeDevTools = 'builtin_chrome-devtools-mcp',
    Markitdown = 'builtin_markitdown',
    Exa = 'builtin_exa',
    // GameData = 'builtin_gamedata'
}

export const globalAgentToolService = new AgentToolService(GlobalLoggerService.getLoggerService());

export function initGlobalAgentToolService() {
    globalAgentToolService.registerToolFactory(BuiltinProvider.Command, async () => {
        const { createCommandTools } = await import("../Tools/Command/index.js");
        return createCommandTools();
    }, '命令执行');
    globalAgentToolService.registerToolFactory(BuiltinProvider.FileSystem, async () => {
        const { createFileSystemTools } = await import("../Tools/FileSystem/index.js");
        return createFileSystemTools();
    }, '文件系统操作');
    globalAgentToolService.registerToolFactory(BuiltinProvider.WebFetch, async () => {
        const { createWebFetchTools } = await import("../Tools/Web/index.js");
        return createWebFetchTools();
    }, 'Web 内容抓取');
    globalAgentToolService.registerToolFactory(BuiltinProvider.Archive, async () => {
        const { createArchiveTools } = await import("../Tools/Archive/index.js");
        return createArchiveTools();
    }, 'ZIP 压缩/解压');
    globalAgentToolService.registerToolFactory(BuiltinProvider.Sleep, async () => {
        const { createSleepTool } = await import("../Tools/Sleep/index.js");
        return [createSleepTool()];
    }, '等待/暂停执行');
    globalAgentToolService.registerToolFactory(BuiltinProvider.Time, async () => {
        const { createTimeTool } = await import("../Tools/Time/index.js");
        return [createTimeTool()];
    }, '获取当前时间');
    globalAgentToolService.registerToolFactory(BuiltinProvider.Scheduler, async () => [], '定时任务调度');
    globalAgentToolService.registerToolFactory(BuiltinProvider.Todo, async () => [], '待办事项管理');
    globalAgentToolService.registerMcpServers({
        [BuiltinProvider.Playwright]: {
            "command": "npx",
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
        BuiltinProvider.Sleep,
        BuiltinProvider.Time,
        // BuiltinProvider.GameData,
    );
}
