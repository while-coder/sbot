import { type AgentTool } from "scorpio.llm";
import { CodeRuntime, createScriptCodeTool, isCommandAvailable, type ProcessManager } from './utils';

type PsInterpreterName = 'pwsh' | 'powershell';

interface PsInterpreter {
    interpreter: PsInterpreterName;
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

export function createPsCodeTool(descriptions: Record<PsInterpreterName, string>, processManager: ProcessManager): AgentTool | null {
    const ps = resolvePsInterpreter();
    if (!ps) return null;
    return createScriptCodeTool({
        name:        'execute_ps_code',
        description: descriptions[ps.interpreter],
        runtime:     CodeRuntime.PowerShell,
        interpreter: ps.interpreter,
        preArgs:     ps.preArgs,
        ext:         '.ps1',
        processManager,
    });
}
