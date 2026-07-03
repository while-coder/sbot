import { type StructuredToolInterface } from '@langchain/core/tools';

export { createShellTool, createReadTaskTool } from './shell';
export { createPythonCodeTool } from './python';
export { createPsCodeTool } from './powershell';

import { createShellTool, createReadTaskTool } from './shell';
import { createPythonCodeTool } from './python';
import { createPsCodeTool } from './powershell';

export function createCommandTools(): StructuredToolInterface[] {
    return [
        createShellTool(),
        createReadTaskTool(),
        createPythonCodeTool(),
        createPsCodeTool(),
    ].filter((t): t is StructuredToolInterface => t !== null);
}
