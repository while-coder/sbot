// 子进程执行框架来自 scorpio.command，本文件仅做 re-export，
// 保持 sbot 内部对 './utils' 的 import 路径不变。
export {
    runProgram,
    runShellCommand,
    getCurrentShell,
    isCommandAvailable,
    validatePath,
    resolveWorkingDir,
    createScriptCodeTool,
    scriptCodeSchema,
    CodeRuntime,
    CodeToolMode,
    MAX_OUTPUT_BYTES,
    ProcessManager,
} from 'scorpio.command';
export type { ScriptCodeToolOptions } from 'scorpio.command';
