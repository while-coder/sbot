/**
 * 命令执行工具集
 * 提供命令行和脚本执行能力
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawn, execSync, type ChildProcess } from 'child_process';
import { setTimeout as sleep } from 'timers/promises';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';

const logger = LoggerService.getLogger('Tools/Command/index.ts');

const MAX_OUTPUT_BYTES = 10 * 1024 * 1024   // 10 MB，超出后截断而非抛异常
const MAX_OUTPUT_LINES = 5_000               // 5000 行，超出后截断
const SIGKILL_TIMEOUT_MS = 200               // SIGTERM 后等待 200ms 再 SIGKILL
const SHELL_BLACKLIST = new Set(['fish', 'nu'])  // 不兼容脚本模式的 shell

/**
 * 检查可执行文件是否存在于 PATH 中
 */
function isCommandAvailable(interpreter: string): boolean {
    try {
        execSync(os.platform() === 'win32' ? `where ${interpreter}` : `which ${interpreter}`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/**
 * 检测当前平台可用的 shell，结果缓存后复用。
 * 黑名单（fish、nu）不支持脚本模式，自动跳过。
 * Windows 优先级：SHELL 环境变量 → SBOT_BASH_PATH → Git Bash → COMSPEC/cmd.exe
 * 其他平台：SHELL 环境变量 → /bin/bash
 */
let _shell: string | undefined;

function resolveShell(): string {
    if (_shell !== undefined) return _shell;

    if (process.platform !== 'win32') {
        const s = process.env.SHELL;
        _shell = (s && !SHELL_BLACKLIST.has(path.basename(s))) ? s : '/bin/bash';
        logger.info(`using shell: ${_shell}`);
        return _shell;
    }

    // Windows：优先用用户指定的 shell（如 Git Bash / WSL）
    const envShell = process.env.SHELL;
    if (envShell && !SHELL_BLACKLIST.has(path.win32.basename(envShell))) {
        _shell = envShell; logger.info(`using shell: ${_shell}`); return _shell;
    }
    if (process.env.SBOT_BASH_PATH) {
        _shell = process.env.SBOT_BASH_PATH; logger.info(`using shell: ${_shell}`); return _shell;
    }

    // 自动查找 Git Bash：git.exe 通常在 C:\Program Files\Git\cmd\git.exe
    // bash.exe 在                C:\Program Files\Git\bin\bash.exe
    try {
        const gitPath = execSync('where git', { stdio: 'pipe' }).toString().split('\n')[0].trim();
        if (gitPath) {
            const bashPath = path.join(gitPath, '..', '..', 'bin', 'bash.exe');
            if (fs.existsSync(bashPath)) { _shell = bashPath; logger.info(`using shell: ${_shell}`); return _shell; }
        }
    } catch { /* git 未安装，继续兜底 */ }

    _shell = process.env.COMSPEC || 'cmd.exe';
    logger.info(`using shell: ${_shell}`);
    return _shell;
}

// ─────────────────────────────────────────────────────────────────────────────
// 进程管理
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 彻底杀死进程及其子进程树。
 * Windows：taskkill /f /t；其他平台：SIGTERM → 等待 → SIGKILL
 */
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

/**
 * 双维度截断输出：超过行数或字节数时附加截断提示，不抛异常。
 */
function truncateOutput(text: string): string {
    const lines = text.split('\n');
    if (lines.length > MAX_OUTPUT_LINES)
        return lines.slice(0, MAX_OUTPUT_LINES).join('\n') + '\n\n[输出已截断]';
    if (text.length > MAX_OUTPUT_BYTES)
        return text.slice(0, MAX_OUTPUT_BYTES) + '\n\n[输出已截断]';
    return text;
}

// ─────────────────────────────────────────────────────────────────────────────
// 公共工具函数
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 验证路径是否为绝对路径，返回规范化后的路径
 */
function validatePath(filePath: string): { valid: boolean; error?: string; absolutePath?: string } {
    if (!path.isAbsolute(filePath)) {
        return { valid: false, error: `路径必须是绝对路径: ${filePath}` };
    }
    return { valid: true, absolutePath: path.normalize(filePath) };
}

/**
 * 解析工作目录：若传入则验证并返回，否则使用 fallback
 */
function resolveWorkingDir(workingDir: string | undefined, fallback: string): { cwd?: string; error?: string } {
    if (!workingDir) return { cwd: fallback };

    const v = validatePath(workingDir);
    if (!v.valid) return { error: v.error };

    const cwd = v.absolutePath!;
    if (!fs.existsSync(cwd))        return { error: `工作目录不存在: ${cwd}` };
    if (!fs.statSync(cwd).isDirectory()) return { error: `路径不是目录: ${cwd}` };

    return { cwd };
}

/**
 * 执行命令并构建统一返回结果。
 * 使用 spawn + detached 进程组，超时后通过 killTree 彻底清理子进程树。
 * 输出按行数和字节数双维度截断，不会因输出过大而抛异常。
 */
async function runCommand(command: string, cwd: string, timeout: number, label: string): Promise<MCPToolResult> {
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
            if (errText) parts.push(createTextContent(`stderr:\n${errText}`));
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

// ─────────────────────────────────────────────────────────────────────────────
// 脚本文件工具工厂
// ─────────────────────────────────────────────────────────────────────────────

const scriptFileSchema = z.object({
    scriptPath: z.string().describe('Absolute path to the script file to execute'),
    workingDir: z.string().describe('Absolute path of the working directory for the script'),
    args:       z.array(z.string()).optional().describe('Command-line arguments to pass to the script'),
    timeout:    z.number().optional().default(60000).describe('Timeout in milliseconds, default 60000 (60 s)'),
});

interface ScriptFileToolOptions {
    name:        string;
    description: string;
    interpreter: string;
    preArgs?:    string;   // 脚本路径之前的额外参数，如 "-ExecutionPolicy Bypass -File"
}

function createScriptFileTool({ name, description, interpreter, preArgs }: ScriptFileToolOptions): StructuredToolInterface | null {
    if (!isCommandAvailable(interpreter)) return null;
    return new DynamicStructuredTool({
        name,
        description,
        schema: scriptFileSchema as any,
        func: async ({ scriptPath, args = [], workingDir, timeout = 60000 }: any): Promise<MCPToolResult> => {
            const pv = validatePath(scriptPath);
            if (!pv.valid) return createErrorResult(pv.error!);

            const absScript = pv.absolutePath!;
            if (!fs.existsSync(absScript))        return createErrorResult(`脚本不存在: ${absScript}`);
            if (!fs.statSync(absScript).isFile()) return createErrorResult(`路径不是文件: ${absScript}`);

            const { cwd, error: cwdError } = resolveWorkingDir(workingDir, workingDir);
            if (cwdError) return createErrorResult(cwdError);

            const argStr  = args.length ? ' ' + args.join(' ') : '';
            const preStr  = preArgs ? ` ${preArgs}` : '';
            const command = `${interpreter}${preStr} "${absScript}"${argStr}`;
            return runCommand(command, cwd!, timeout, name);
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 脚本内容工具工厂
// ─────────────────────────────────────────────────────────────────────────────

const scriptCodeSchema = z.object({
    code:       z.string().describe('Script source code to execute; written to a temp file automatically'),
    workingDir: z.string().describe('Absolute path of the working directory for the script'),
    args:       z.array(z.string()).optional().describe('Command-line arguments to pass to the script'),
    timeout:    z.number().optional().default(60000).describe('Timeout in milliseconds, default 60000 (60 s)'),
});

interface ScriptCodeToolOptions {
    name:        string;
    description: string;
    interpreter: string;
    preArgs?:    string;   // 脚本路径之前的额外参数
    ext:         string;
}

function createScriptCodeTool({ name, description, interpreter, preArgs, ext }: ScriptCodeToolOptions): StructuredToolInterface | null {
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

// ─────────────────────────────────────────────────────────────────────────────
// 各脚本类型工具
// ─────────────────────────────────────────────────────────────────────────────

export function createPythonScriptTool(): StructuredToolInterface | null {
    return createScriptFileTool({
        name:        'execute_python_script',
        description: 'Runs an existing Python script file (.py) by absolute path. Use this when the script is already on disk. Use execute_python_code to run an inline code snippet without creating a file first.',
        interpreter: 'python',
    });
}
export function createPythonCodeTool(): StructuredToolInterface | null {
    return createScriptCodeTool({
        name:        'execute_python_code',
        description: 'Runs a Python code snippet (string) by writing it to a temp file and executing it. Use this for inline scripts or quick calculations. Use execute_python_script when the script already exists on disk.',
        interpreter: 'python',
        ext:         '.py',
    });
}

interface PsInterpreter {
    interpreter: string;
    preArgs?:    string;
    /** 语法说明，注入 description 供 LLM 感知版本差异 */
    syntaxNote:  string;
}

/** 选择可用的 PowerShell 解释器：优先 pwsh，回退到 powershell */
function resolvePsInterpreter(): PsInterpreter | null {
    if (isCommandAvailable('pwsh')) return {
        interpreter: 'pwsh',
        syntaxNote:  'PowerShell Core (pwsh) — cross-platform, PS 7+ syntax (e.g. ternary operator, null coalescing, foreach-object -Parallel)',
    };
    if (isCommandAvailable('powershell')) return {
        interpreter: 'powershell',
        preArgs:     '-ExecutionPolicy Bypass -File',
        syntaxNote:  'Windows PowerShell (powershell.exe) — Windows-only, PS 5.1 syntax; avoid PS 7+ features like ternary operator (?:) or null coalescing (??=)',
    };
    return null;
}

export function createPsScriptTool(): StructuredToolInterface | null {
    const ps = resolvePsInterpreter();
    if (!ps) return null;
    return new DynamicStructuredTool({
        name:        'execute_ps_script',
        description: `Runs an existing PowerShell script file (.ps1) by absolute path. Currently using: ${ps.syntaxNote}. Use execute_ps_code to run an inline snippet instead.`,
        schema: scriptFileSchema as any,
        func: async ({ scriptPath, args = [], workingDir, timeout = 60000 }: any): Promise<MCPToolResult> => {
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
        description: `Runs a PowerShell code snippet (string) by writing it to a temp .ps1 file and executing it. Currently using: ${ps.syntaxNote}. Use execute_ps_script when the script already exists on disk.`,
        schema: scriptCodeSchema as any,
        func: async ({ code, args = [], workingDir, timeout = 60000 }: any): Promise<MCPToolResult> => {
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

// ─────────────────────────────────────────────────────────────────────────────
// 命令行工具
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 创建执行命令行的工具
 */
export function createExecuteCommandTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'execute_command',
        description: `Executes a shell command or multi-line shell script in a given working directory. Returns stdout and stderr separately. Default timeout 60 s.

Supports all forms:
- Single command: "git status"
- Chained commands: "npm install && npm run build"
- Multi-line script: "for f in *.log; do rm \\"$f\\"; done"

IMPORTANT: Do NOT use this tool for file operations — use the dedicated file tools instead:
- Read/write files: use read / write / edit
- Search file content: use grep
- Find files by name: use glob
- List directory tree: use ls`,
        schema: z.object({
            command:    z.string().describe('Command or multi-line shell script to run, e.g. "git status", "npm install && npm run build", or a newline-separated script'),
            workingDir: z.string().describe('Absolute path of the working directory'),
            timeout:    z.number().optional().default(60000).describe('Timeout in milliseconds, default 60000 (60 s)'),
        }) as any,
        func: async ({ command, workingDir, timeout = 60000 }: any): Promise<MCPToolResult> => {
            const { cwd, error } = resolveWorkingDir(workingDir, workingDir);
            if (error) return createErrorResult(error);
            return runCommand(command, cwd!, timeout, `command "${command}"`);
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 工具集合
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 创建所有命令执行工具
 */
export function createCommandTools(): StructuredToolInterface[] {
    return [
        createExecuteCommandTool(),
        createPythonScriptTool(),
        createPythonCodeTool(),
        createPsScriptTool(),
        createPsCodeTool(),
    ].filter((t): t is StructuredToolInterface => t !== null);
}
