// 子进程执行框架已下沉到 scorpio.ai/Tools/Process，本文件仅做 re-export，
// 保持 sbot 内部对 './utils' 的 import 路径不变。
export {
    runProgram,
    runShellCommand,
    resolveShell,
    isCommandAvailable,
    validatePath,
    resolveWorkingDir,
    createScriptCodeTool,
    scriptCodeSchema,
    MAX_OUTPUT_BYTES,
} from 'scorpio.ai';
export type { ScriptCodeToolOptions } from 'scorpio.ai';
