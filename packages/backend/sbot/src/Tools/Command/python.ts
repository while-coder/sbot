import { type StructuredToolInterface } from '@langchain/core/tools';
import { loadPrompt } from '../../Core/PromptLoader';
import { CodeRuntime, createScriptCodeTool, isCommandAvailable } from './utils';

// 现代 Linux/macOS 默认只有 python3，Windows 通常是 python；都试一遍。
let _pythonInterpreter: string | null | undefined;
function resolvePython(): string | null {
    if (_pythonInterpreter !== undefined) return _pythonInterpreter;
    if (isCommandAvailable('python'))       _pythonInterpreter = 'python';
    else if (isCommandAvailable('python3')) _pythonInterpreter = 'python3';
    else                                    _pythonInterpreter = null;
    return _pythonInterpreter;
}

export function createPythonCodeTool(): StructuredToolInterface | null {
    const interpreter = resolvePython();
    if (!interpreter) return null;
    return createScriptCodeTool({
        name:        'execute_python_code',
        description: loadPrompt('tools/command/python_code.txt'),
        runtime:     CodeRuntime.Python,
        interpreter,
        ext:         '.py',
    });
}
