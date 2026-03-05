import { AgentToolService } from "scorpio.ai";
import { config } from "./Config.js";
import { createCommandTools } from "./Tools/Command/index.js";
import { createFileSystemTools } from "./Tools/FileSystem/index.js";
import { createSchedulerTools } from "./Tools/Scheduler/index.js";

export enum BuiltinProvider {
    Command = 'builtin_command',
    FileSystem = 'builtin_filesystem',
    Scheduler = 'builtin_scheduler',
    Playwright = 'builtin_playwright',
    ChromeDevTools = 'builtin_chrome-devtools-mcp',
    Markitdown = 'builtin_markitdown',
    DesktopCommander = 'builtin_desktop-commander',
}

export const globalAgentToolService = new AgentToolService();

export function initGlobalAgentToolService() {
    globalAgentToolService.registerToolFactory(BuiltinProvider.Command, async () => createCommandTools());
    globalAgentToolService.registerToolFactory(BuiltinProvider.FileSystem, async () => createFileSystemTools());
    globalAgentToolService.registerToolFactory(BuiltinProvider.Scheduler, async () => createSchedulerTools());
    globalAgentToolService.registerMcpServers({
        [BuiltinProvider.Playwright]: {
            "command": "npx.cmd",
            "args": [
                "@playwright/mcp@latest"
            ]
        },
        [BuiltinProvider.ChromeDevTools]: {
            "type": "stdio",
            "command": "npx",
            "args": [
                "--registry",
                "https://registry.npmjs.org",
                "chrome-devtools-mcp@0.18.1"
            ]
        },
        [BuiltinProvider.Markitdown]: {
            "type": "stdio",
            "command": "uvx",
            "args": [
                "markitdown-mcp@0.0.1a4"
            ]
        },
        [BuiltinProvider.DesktopCommander]: {
            "type": "stdio",
            "command": "npx",
            "args": [
                "--registry",
                "https://registry.npmjs.org",
                "@wonderwhy-er/desktop-commander@0.2.38"
            ]
        }
    })
    globalAgentToolService.registerMcpServers(config.getGlobalMcpServers());
}

export function refreshGlobalAgentToolService() {
    globalAgentToolService.reset();
    initGlobalAgentToolService()
}
