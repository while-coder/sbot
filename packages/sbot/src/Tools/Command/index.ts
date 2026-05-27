import { type StructuredToolInterface } from '@langchain/core/tools';

export { createShellTool } from './shell';
export { createPythonCodeTool } from './python';
export { createPsCodeTool } from './powershell';

import { createShellTool } from './shell';
import { createPythonCodeTool } from './python';
import { createPsCodeTool } from './powershell';

export function createCommandTools(): StructuredToolInterface[] {
    return [
        createShellTool(),
        createPythonCodeTool(),
        createPsCodeTool(),
    ].filter((t): t is StructuredToolInterface => t !== null);
}
