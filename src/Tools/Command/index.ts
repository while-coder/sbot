/**
 * 命令执行工具集
 * 提供命令行和脚本执行能力
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';

const logger = LoggerService.getLogger('Tools/Command/index.ts');
const execAsync = promisify(exec);

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
 * 执行命令并构建统一返回结果
 */
async function runCommand(command: string, cwd: string, timeout: number, label: string): Promise<MCPToolResult> {
    try {
        const { stdout, stderr } = await execAsync(command, {
            cwd,
            env: process.env,
            timeout,
            maxBuffer: 10 * 1024 * 1024,
        });

        const parts = [];
        if (stdout.trim()) parts.push(createTextContent(stdout.trim()));
        if (stderr.trim()) parts.push(createTextContent(`stderr:\n${stderr.trim()}`));
        return createSuccessResult(...parts);

    } catch (error: any) {
        logger.error(`Error executing ${label}: ${error.message}`);
        const details = [createTextContent(`错误: ${error.message}`)];
        if (error.stdout?.trim()) details.push(createTextContent(`stdout:\n${error.stdout.trim()}`));
        if (error.stderr?.trim()) details.push(createTextContent(`stderr:\n${error.stderr.trim()}`));
        return { content: details, isError: true };
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 脚本文件工具工厂
// ─────────────────────────────────────────────────────────────────────────────

const scriptFileSchema = z.object({
    scriptPath: z.string().describe('脚本文件的绝对路径'),
    workingDir: z.string().describe('工作目录绝对路径'),
    args:       z.array(z.string()).optional().describe('传递给脚本的参数列表'),
    timeout:    z.number().optional().default(60000).describe('超时时间（毫秒），默认 60000'),
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
    code:       z.string().describe('脚本代码内容字符串，会写入临时文件后执行'),
    workingDir: z.string().describe('工作目录绝对路径'),
    args:       z.array(z.string()).optional().describe('传递给脚本的参数列表'),
    timeout:    z.number().optional().default(60000).describe('超时时间（毫秒），默认 60000'),
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
        description: '执行 Python 脚本文件（.py）。传入脚本文件的绝对路径（scriptPath）。',
        interpreter: 'python',
    });
}
export function createPythonCodeTool(): StructuredToolInterface | null {
    return createScriptCodeTool({
        name:        'execute_python_code',
        description: '执行 Python 代码片段。传入 Python 代码字符串（code），会写入临时文件后执行。',
        interpreter: 'python',
        ext:         '.py',
    });
}

export function createShellScriptTool(): StructuredToolInterface | null {
    return createScriptFileTool({
        name:        'execute_shell_script',
        description: '执行 Shell/Bash 脚本文件（.sh）。传入脚本文件的绝对路径（scriptPath）。',
        interpreter: 'bash',
    });
}
export function createShellCodeTool(): StructuredToolInterface | null {
    return createScriptCodeTool({
        name:        'execute_shell_code',
        description: '执行 Shell/Bash 代码片段。传入 Shell 代码字符串（code），会写入临时文件后执行。',
        interpreter: 'bash',
        ext:         '.sh',
    });
}

export function createNodeScriptTool(): StructuredToolInterface | null {
    return createScriptFileTool({
        name:        'execute_node_script',
        description: '执行 Node.js 脚本文件（.js）。传入脚本文件的绝对路径（scriptPath）。',
        interpreter: 'node',
    });
}
export function createNodeCodeTool(): StructuredToolInterface | null {
    return createScriptCodeTool({
        name:        'execute_node_code',
        description: '执行 Node.js 代码片段。传入 JavaScript 代码字符串（code），会写入临时文件后执行。',
        interpreter: 'node',
        ext:         '.js',
    });
}

export function createRubyScriptTool(): StructuredToolInterface | null {
    return createScriptFileTool({
        name:        'execute_ruby_script',
        description: '执行 Ruby 脚本文件（.rb）。传入脚本文件的绝对路径（scriptPath）。',
        interpreter: 'ruby',
    });
}
export function createRubyCodeTool(): StructuredToolInterface | null {
    return createScriptCodeTool({
        name:        'execute_ruby_code',
        description: '执行 Ruby 代码片段。传入 Ruby 代码字符串（code），会写入临时文件后执行。',
        interpreter: 'ruby',
        ext:         '.rb',
    });
}

export function createPerlScriptTool(): StructuredToolInterface | null {
    return createScriptFileTool({
        name:        'execute_perl_script',
        description: '执行 Perl 脚本文件（.pl）。传入脚本文件的绝对路径（scriptPath）。',
        interpreter: 'perl',
    });
}
export function createPerlCodeTool(): StructuredToolInterface | null {
    return createScriptCodeTool({
        name:        'execute_perl_code',
        description: '执行 Perl 代码片段。传入 Perl 代码字符串（code），会写入临时文件后执行。',
        interpreter: 'perl',
        ext:         '.pl',
    });
}

export function createPhpScriptTool(): StructuredToolInterface | null {
    return createScriptFileTool({
        name:        'execute_php_script',
        description: '执行 PHP 脚本文件（.php）。传入脚本文件的绝对路径（scriptPath）。',
        interpreter: 'php',
    });
}
export function createPhpCodeTool(): StructuredToolInterface | null {
    return createScriptCodeTool({
        name:        'execute_php_code',
        description: '执行 PHP 代码片段。传入 PHP 代码字符串（code），会写入临时文件后执行。',
        interpreter: 'php',
        ext:         '.php',
    });
}

export function createPowerShellScriptTool(): StructuredToolInterface | null {
    return createScriptFileTool({
        name:        'execute_powershell_script',
        description: '执行 Windows PowerShell 脚本文件（.ps1）。传入脚本文件的绝对路径（scriptPath）。',
        interpreter: 'powershell',
        preArgs:     '-ExecutionPolicy Bypass -File',
    });
}
export function createPowerShellCodeTool(): StructuredToolInterface | null {
    return createScriptCodeTool({
        name:        'execute_powershell_code',
        description: '执行 Windows PowerShell 代码片段。传入代码字符串（code），会写入临时文件后执行。',
        interpreter: 'powershell',
        preArgs:     '-ExecutionPolicy Bypass -File',
        ext:         '.ps1',
    });
}
export function createPwshScriptTool(): StructuredToolInterface | null {
    return createScriptFileTool({
        name:        'execute_pwsh_script',
        description: '执行 PowerShell Core (pwsh) 脚本文件（.ps1）。传入脚本文件的绝对路径（scriptPath）。',
        interpreter: 'pwsh',
    });
}
export function createPwshCodeTool(): StructuredToolInterface | null {
    return createScriptCodeTool({
        name:        'execute_pwsh_code',
        description: '执行 PowerShell Core (pwsh) 代码片段。传入代码字符串（code），会写入临时文件后执行。',
        interpreter: 'pwsh',
        ext:         '.ps1',
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
        description: '执行命令行命令（如 ls, git status, npm install 等）。注意：命令会在当前工作目录下执行。',
        schema: z.object({
            command:    z.string().describe('要执行的命令（完整的命令字符串，如 "ls -la", "git status"）'),
            workingDir: z.string().describe('工作目录绝对路径'),
            timeout:    z.number().optional().default(60000).describe('超时时间（毫秒），默认为 60000（60秒）'),
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
        createShellScriptTool(),
        createShellCodeTool(),
        createNodeScriptTool(),
        createNodeCodeTool(),
        createRubyScriptTool(),
        createRubyCodeTool(),
        createPerlScriptTool(),
        createPerlCodeTool(),
        createPhpScriptTool(),
        createPhpCodeTool(),
        createPowerShellScriptTool(),
        createPowerShellCodeTool(),
        createPwshScriptTool(),
        createPwshCodeTool(),
    ].filter((t): t is StructuredToolInterface => t !== null);
}
