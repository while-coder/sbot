import { type StructuredToolInterface } from '@langchain/core/tools';

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
}

export function createCommandTools(options: CreateCommandToolsOptions): StructuredToolInterface[] {
    const { descriptions } = options;
    return [
        createShellTool(descriptions.shell),
        createReadProcessTool(descriptions.readProcess),
        createWriteProcessTool(descriptions.writeProcess),
        createPythonCodeTool(descriptions.pythonCode),
        createPsCodeTool(descriptions.powerShellCode),
    ].filter((t): t is StructuredToolInterface => t !== null);
}
