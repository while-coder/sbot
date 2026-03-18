import fs from 'fs';
import os from 'os';
import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { createErrorResult } from 'scorpio.ai';
import { loadPrompt } from '../../Core/PromptLoader';
import { scriptFileSchema, scriptCodeSchema, resolvePsInterpreter, validatePath, resolveWorkingDir, runCommand } from './utils';

export function createPsScriptTool(): StructuredToolInterface | null {
    const ps = resolvePsInterpreter();
    if (!ps) return null;
    return new DynamicStructuredTool({
        name:        'execute_ps_script',
        description: loadPrompt('tools/command/ps_script.txt', { syntaxNote: ps.syntaxNote }),
        schema: scriptFileSchema as any,
        func: async ({ scriptPath, args = [], workingDir, timeout = 60000 }: any) => {
            const pv = validatePath(scriptPath);
            if (!pv.valid) return createErrorResult(pv.error!);
            const absScript = pv.absolutePath!;
            if (!fs.existsSync(absScript))        return createErrorResult(`脚本不存在: ${absScript}`);
            if (!fs.statSync(absScript).isFile()) return createErrorResult(`路径不是文件: ${absScript}`);
            const { cwd, error: cwdError } = resolveWorkingDir(workingDir, workingDir);
            if (cwdError) return createErrorResult(cwdError);
            const argStr  = args.length ? ' ' + args.join(' ') : '';
            const preStr  = ps.preArgs ? ` ${ps.preArgs}` : '';
            const command = `${ps.interpreter}${preStr} "${absScript}"${argStr}`;
            return runCommand(command, cwd!, timeout, 'execute_ps_script');
        },
    });
}

export function createPsCodeTool(): StructuredToolInterface | null {
    const ps = resolvePsInterpreter();
    if (!ps) return null;
    return new DynamicStructuredTool({
        name:        'execute_ps_code',
        description: loadPrompt('tools/command/ps_code.txt', { syntaxNote: ps.syntaxNote }),
        schema: scriptCodeSchema as any,
        func: async ({ code, args = [], workingDir, timeout = 60000 }: any) => {
            const tmpFile = path.join(os.tmpdir(), `sbot_script_${Date.now()}.ps1`);
            fs.writeFileSync(tmpFile, code, 'utf-8');
            try {
                const { cwd, error: cwdError } = resolveWorkingDir(workingDir, workingDir);
                if (cwdError) return createErrorResult(cwdError);
                const argStr  = args.length ? ' ' + args.join(' ') : '';
                const preStr  = ps.preArgs ? ` ${ps.preArgs}` : '';
                const command = `${ps.interpreter}${preStr} "${tmpFile}"${argStr}`;
                return await runCommand(command, cwd!, timeout, 'execute_ps_code');
            } finally {
                try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
            }
        },
    });
}
