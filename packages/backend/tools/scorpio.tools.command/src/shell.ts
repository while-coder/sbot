import {
    createShellTool as createCoreShellTool,
    createReadProcessTool as createCoreReadProcessTool,
    createWriteProcessTool as createCoreWriteProcessTool,
    type ProcessManager,
} from 'scorpio.command';
import { type AgentTool } from "scorpio.llm";

export function createShellTool(description: string, processManager: ProcessManager): AgentTool {
    return createCoreShellTool({
        description,
        processManager,
    });
}

export function createReadProcessTool(description: string, processManager: ProcessManager): AgentTool {
    return createCoreReadProcessTool({
        description,
        processManager,
    });
}

export function createWriteProcessTool(description: string, processManager: ProcessManager): AgentTool {
    return createCoreWriteProcessTool({
        description,
        processManager,
    });
}
