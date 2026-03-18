import { type StructuredToolInterface } from '@langchain/core/tools';
import { loadPrompt } from '../../Core/PromptLoader';
import { createScriptFileTool, createScriptCodeTool } from './utils';

export function createPythonScriptTool(): StructuredToolInterface | null {
    return createScriptFileTool({
        name:        'execute_python_script',
        description: loadPrompt('tools/command/python_script.txt'),
        interpreter: 'python',
    });
}

export function createPythonCodeTool(): StructuredToolInterface | null {
    return createScriptCodeTool({
        name:        'execute_python_code',
        description: loadPrompt('tools/command/python_code.txt'),
        interpreter: 'python',
        ext:         '.py',
    });
}
