import { type StructuredToolInterface } from '@langchain/core/tools';
import { loadPrompt } from '../../Core/PromptLoader';
import { CodeRuntime, createScriptCodeTool, isCommandAvailable } from './utils';

interface PsInterpreter {
    interpreter: string;
    preArgs:     string[];
}

// -NoProfile 跳过 $PROFILE 加载，避免冷启动 2~5 s 的看似假死。
// -File 让脚本路径与 args 的传递行为在 pwsh 与 powershell 之间保持一致。
let _psInterpreter: PsInterpreter | null | undefined;
function resolvePsInterpreter(): PsInterpreter | null {
    if (_psInterpreter !== undefined) return _psInterpreter;
    if (isCommandAvailable('pwsh'))            _psInterpreter = { interpreter: 'pwsh',       preArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'] };
    else if (isCommandAvailable('powershell')) _psInterpreter = { interpreter: 'powershell', preArgs: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'] };
    else                                       _psInterpreter = null;
    return _psInterpreter;
}

export function createPsCodeTool(): StructuredToolInterface | null {
    const ps = resolvePsInterpreter();
    if (!ps) return null;
    return createScriptCodeTool({
        name:        'execute_ps_code',
        description: loadPrompt(`tools/command/ps_code_${ps.interpreter}.txt`),
        runtime:     CodeRuntime.PowerShell,
        interpreter: ps.interpreter,
        preArgs:     ps.preArgs,
        ext:         '.ps1',
    });
}
