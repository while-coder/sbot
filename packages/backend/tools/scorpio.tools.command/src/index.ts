import { type StructuredToolInterface } from '@langchain/core/tools';
import { ProcessManager, setCommandLogger, type CommandLogger } from 'scorpio.command';

export { createShellTool, createReadProcessTool, createWriteProcessTool } from './shell';
export { createPythonCodeTool } from './python';
export { createPsCodeTool } from './powershell';

import { createShellTool, createReadProcessTool, createWriteProcessTool } from './shell';
import { createPythonCodeTool } from './python';
import { createPsCodeTool } from './powershell';

export interface CommandToolDescriptions {
    shell: string;
    readProcess: string;
    writeProcess: string;
    pythonCode: string;
    powerShellCode: Record<'pwsh' | 'powershell', string>;
}

export interface CreateCommandToolsOptions {
    descriptions: CommandToolDescriptions;
    logger?: CommandLogger;
    processOwner?: string;
}

const processManagers = new Map<string, ProcessManager>();

function getProcessManager(processOwner: string | undefined): ProcessManager {
    const owner = processOwner?.trim() || 'default';
    const existing = processManagers.get(owner);
    if (existing) return existing;

    const manager = new ProcessManager(() => {
        if (processManagers.get(owner) === manager) processManagers.delete(owner);
    });
    processManagers.set(owner, manager);
    return manager;
}

export function createCommandTools(options: CreateCommandToolsOptions): StructuredToolInterface[] {
    const { descriptions } = options;
    setCommandLogger(options.logger);
    const processManager = getProcessManager(options.processOwner);
    return [
        createShellTool(descriptions.shell, processManager),
        createReadProcessTool(descriptions.readProcess, processManager),
        createWriteProcessTool(descriptions.writeProcess, processManager),
        createPythonCodeTool(descriptions.pythonCode, processManager),
        createPsCodeTool(descriptions.powerShellCode, processManager),
    ].filter((t): t is StructuredToolInterface => t !== null);
}
