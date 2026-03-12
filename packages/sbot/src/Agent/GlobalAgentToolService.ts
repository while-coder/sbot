import { AgentToolService, GlobalLoggerService } from "scorpio.ai";
import { config } from "../Core/Config.js";
import { createCommandTools } from "../Tools/Command/index.js";
import { createFileSystemTools } from "../Tools/FileSystem/index.js";
import { createSchedulerTools } from "../Tools/Scheduler/index.js";

export enum BuiltinProvider {
    Command = 'builtin_command',
    FileSystem = 'builtin_filesystem',
    Scheduler = 'builtin_scheduler',
    
    Playwright = 'builtin_playwright',
    ChromeDevTools = 'builtin_chrome-devtools-mcp',
    Markitdown = 'builtin_markitdown'
}

export const globalAgentToolService = new AgentToolService(GlobalLoggerService.getLoggerService());

export function initGlobalAgentToolService() {
    globalAgentToolService.registerToolFactory(BuiltinProvider.Command, async () => createCommandTools(), '命令执行');
    globalAgentToolService.registerToolFactory(BuiltinProvider.FileSystem, async () => createFileSystemTools(), '文件系统操作');
    globalAgentToolService.registerToolFactory(BuiltinProvider.Scheduler, async () => createSchedulerTools(), '定时任务管理');
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
    })
    globalAgentToolService.registerMcpServers(config.getGlobalMcpServers());
}

export function refreshGlobalAgentToolService() {
    globalAgentToolService.reset();
    initGlobalAgentToolService()
}
