import { type StructuredToolInterface } from '@langchain/core/tools';

export { createShellTool } from './shell';
export { createPythonScriptTool, createPythonCodeTool } from './python';
export { createPsScriptTool, createPsCodeTool } from './powershell';

import { createShellTool } from './shell';
import { createPythonScriptTool, createPythonCodeTool } from './python';
import { createPsScriptTool, createPsCodeTool } from './powershell';

export function createCommandTools(): StructuredToolInterface[] {
    return [
        createShellTool(),
        createPythonScriptTool(),
        createPythonCodeTool(),
        createPsScriptTool(),
        createPsCodeTool(),
    ].filter((t): t is StructuredToolInterface => t !== null);
}

