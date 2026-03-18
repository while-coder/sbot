import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, execSync, type ChildProcess } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import { z } from 'zod';
import { LoggerService } from '../../Core/LoggerService';
import { createTextContent, createSuccessResult, MCPToolResult } from 'scorpio.ai';

export const logger = LoggerService.getLogger('Tools/Command');

export const MAX_OUTPUT_BYTES = 10 * 1024 * 1024
export const MAX_OUTPUT_LINES = 5_000
const SIGKILL_TIMEOUT_MS = 200
const SHELL_BLACKLIST = new Set(['fish', 'nu'])

export function isCommandAvailable(interpreter: string): boolean {
    try {
        execSync(os.platform() === 'win32' ? `where ${interpreter}` : `which ${interpreter}`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

let _shell: string | undefined;

export function resolveShell(): string {
    if (_shell !== undefined) return _shell;

    if (process.platform !== 'win32') {
        const s = process.env.SHELL;
        _shell = (s && !SHELL_BLACKLIST.has(path.basename(s))) ? s : '/bin/bash';
        logger.info(`using shell: ${_shell}`);
        return _shell;
    }

    const envShell = process.env.SHELL;
    if (envShell && !SHELL_BLACKLIST.has(path.win32.basename(envShell))) {
        _shell = envShell; logger.info(`using shell: ${_shell}`); return _shell;
    }
    if (process.env.SBOT_BASH_PATH) {
        _shell = process.env.SBOT_BASH_PATH; logger.info(`using shell: ${_shell}`); return _shell;
    }

    try {
        const gitPath = execSync('where git', { stdio: 'pipe' }).toString().split('\n')[0].trim();
        if (gitPath) {
            const bashPath = path.join(gitPath, '..', '..', 'bin', 'bash.exe');
            if (fs.existsSync(bashPath)) { _shell = bashPath; logger.info(`using shell: ${_shell}`); return _shell; }
        }
    } catch { /* git not installed */ }

    _shell = process.env.COMSPEC || 'cmd.exe';
    logger.info(`using shell: ${_shell}`);
    return _shell;
}

async function killTree(proc: ChildProcess, isExited: () => boolean): Promise<void> {
    const pid = proc.pid;
    if (!pid || isExited()) return;

    if (process.platform === 'win32') {
        await new Promise<void>((resolve) => {
            const killer = spawn('taskkill', ['/pid', String(pid), '/f', '/t'], { stdio: 'ignore' });
            killer.once('exit', () => resolve());
            killer.once('error', () => resolve());
        });
        return;
    }

    try {
        process.kill(-pid, 'SIGTERM');
        await sleep(SIGKILL_TIMEOUT_MS);
        if (!isExited()) process.kill(-pid, 'SIGKILL');
    } catch {
        proc.kill('SIGTERM');
        await sleep(SIGKILL_TIMEOUT_MS);
        if (!isExited()) proc.kill('SIGKILL');
    }
}

export function truncateOutput(text: string): string {
    const lines = text.split('\n');
    if (lines.length > MAX_OUTPUT_LINES)
        return lines.slice(0, MAX_OUTPUT_LINES).join('\n') + '\n\n[output truncated]';
    if (text.length > MAX_OUTPUT_BYTES)
        return text.slice(0, MAX_OUTPUT_BYTES) + '\n\n[output truncated]';
    return text;
}

export function validatePath(filePath: string): { valid: boolean; error?: string; absolutePath?: string } {
    if (!path.isAbsolute(filePath)) {
        return { valid: false, error: `Path must be absolute: ${filePath}` };
    }
    return { valid: true, absolutePath: path.normalize(filePath) };
}

export function resolveWorkingDir(workingDir: string | undefined, fallback: string): { cwd?: string; error?: string } {
    if (!workingDir) return { cwd: fallback };

    const v = validatePath(workingDir);
    if (!v.valid) return { error: v.error };

    const cwd = v.absolutePath!;
    if (!fs.existsSync(cwd))             return { error: `Working directory not found: ${cwd}` };
    if (!fs.statSync(cwd).isDirectory()) return { error: `Path is not a directory: ${cwd}` };

    return { cwd };
}

export async function runCommand(command: string, cwd: string, timeout: number, label: string): Promise<MCPToolResult> {
    return new Promise<MCPToolResult>((resolve) => {
        let stdout = '';
        let stderr = '';
        let timedOut = false;
        let exited = false;

        const proc = spawn(command, {
            shell: resolveShell(),
            cwd,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
            detached: process.platform !== 'win32',
        });

        proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

        const kill = () => killTree(proc, () => exited);

        const timeoutTimer = setTimeout(() => { timedOut = true; void kill(); }, timeout);

        proc.once('exit', () => {
            exited = true;
            clearTimeout(timeoutTimer);
            const parts = [];
            const outText = truncateOutput(stdout.trim());
            const errText = truncateOutput(stderr.trim());
            if (outText) parts.push(createTextContent(outText));
            if (errText) parts.push(createTextContent(`错误输出:\n${errText}`));
            if (timedOut) parts.push(createTextContent(`命令执行超时 (${timeout} ms)`));
            resolve(createSuccessResult(...parts));
        });

        proc.once('error', (error: Error) => {
            exited = true;
            clearTimeout(timeoutTimer);
            logger.error(`Error executing ${label}: ${error.message}`);
            resolve({ content: [createTextContent(`错误: ${error.message}`)], isError: true });
        });
    });
}

export const scriptFileSchema = z.object({
    scriptPath: z.string().describe('Absolute path to the script file to execute'),
    workingDir: z.string().describe('Absolute path of the working directory for the script'),
    args:       z.array(z.string()).optional().describe('Command-line arguments to pass to the script'),
    timeout:    z.number().optional().default(60000).describe('Timeout in milliseconds, default 60000 (60 s)'),
});

export const scriptCodeSchema = z.object({
    code:       z.string().describe('Script source code to execute; written to a temp file automatically'),
    workingDir: z.string().describe('Absolute path of the working directory for the script'),
    args:       z.array(z.string()).optional().describe('Command-line arguments to pass to the script'),
    timeout:    z.number().optional().default(60000).describe('Timeout in milliseconds, default 60000 (60 s)'),
});

export interface PsInterpreter {
    interpreter: string;
    preArgs?:    string;
}

export function resolvePsInterpreter(): PsInterpreter | null {
    if (isCommandAvailable('pwsh'))       return { interpreter: 'pwsh' };
    if (isCommandAvailable('powershell')) return { interpreter: 'powershell', preArgs: '-ExecutionPolicy Bypass -File' };
    return null;
}

// ─── Script file/code tool factories (used by Python tools) ──────────────────

export interface ScriptFileToolOptions {
    name:        string;
    description: string;
    interpreter: string;
    preArgs?:    string;
}

export interface ScriptCodeToolOptions {
    name:        string;
    description: string;
    interpreter: string;
    preArgs?:    string;
    ext:         string;
}

import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { createErrorResult } from 'scorpio.ai';

export function createScriptFileTool({ name, description, interpreter, preArgs }: ScriptFileToolOptions): StructuredToolInterface | null {
    if (!isCommandAvailable(interpreter)) return null;
    return new DynamicStructuredTool({
        name,
        description,
        schema: scriptFileSchema as any,
        func: async ({ scriptPath, args = [], workingDir, timeout = 60000 }: any): Promise<MCPToolResult> => {
            const pv = validatePath(scriptPath);
            if (!pv.valid) return createErrorResult(pv.error!);

            const absScript = pv.absolutePath!;
            if (!fs.existsSync(absScript))        return createErrorResult(`Script not found: ${absScript}`);
            if (!fs.statSync(absScript).isFile()) return createErrorResult(`Path is not a file: ${absScript}`);

            const { cwd, error: cwdError } = resolveWorkingDir(workingDir, workingDir);
            if (cwdError) return createErrorResult(cwdError);

            const argStr  = args.length ? ' ' + args.join(' ') : '';
            const preStr  = preArgs ? ` ${preArgs}` : '';
            const command = `${interpreter}${preStr} "${absScript}"${argStr}`;
            return runCommand(command, cwd!, timeout, name);
        },
    });
}

export function createScriptCodeTool({ name, description, interpreter, preArgs, ext }: ScriptCodeToolOptions): StructuredToolInterface | null {
    if (!isCommandAvailable(interpreter)) return null;
    return new DynamicStructuredTool({
        name,
        description,
        schema: scriptCodeSchema as any,
        func: async ({ code, args = [], workingDir, timeout = 60000 }: any): Promise<MCPToolResult> => {
            const tmpFile = path.join(os.tmpdir(), `sbot_script_${Date.now()}${ext}`);
            fs.writeFileSync(tmpFile, code, 'utf-8');

            try {
                const { cwd, error: cwdError } = resolveWorkingDir(workingDir, workingDir);
                if (cwdError) return createErrorResult(cwdError);

                const argStr  = args.length ? ' ' + args.join(' ') : '';
                const preStr  = preArgs ? ` ${preArgs}` : '';
                const command = `${interpreter}${preStr} "${tmpFile}"${argStr}`;
                return await runCommand(command, cwd!, timeout, name);
            } finally {
                try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
            }
        },
    });
}
