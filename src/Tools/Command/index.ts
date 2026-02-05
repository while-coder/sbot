/**
 * 命令执行工具集
 * 提供命令行和脚本执行能力
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from '../ToolsConfig';

const logger = LoggerService.getLogger('Tools/Command/index.ts');
const execAsync = promisify(exec);

/**
 * 验证路径是否为绝对路径
 */
function validatePath(filePath: string): { valid: boolean; error?: string; absolutePath?: string } {
    // 检查是否为绝对路径
    if (!path.isAbsolute(filePath)) {
        return {
            valid: false,
            error: `路径必须是绝对路径: ${filePath}`
        };
    }

    const absolutePath = path.normalize(filePath);

    return {
        valid: true,
        absolutePath
    };
}

/**
 * 创建执行命令行的工具
 */
export function createExecuteCommandTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'execute_command',
        description: '执行命令行命令（如 ls, git status, npm install 等）。注意：命令会在当前工作目录下执行。',
        schema: z.object({
            command: z.string().describe('要执行的命令（完整的命令字符串，如 "ls -la", "git status"）'),
            workingDir: z.string().optional().describe('可选的工作目录绝对路径，默认为当前工作目录'),
            timeout: z.number().optional().default(60000).describe('超时时间（毫秒），默认为 60000（60秒）')
        }) as any,
        func: async ({ command, workingDir, timeout = 60000 }: any): Promise<MCPToolResult> => {
            try {
                // 如果指定了工作目录，验证路径
                if (workingDir) {
                    const validation = validatePath(workingDir);
                    if (!validation.valid) {
                        return createErrorResult(validation.error!);
                    }

                    const absoluteWorkingDir = validation.absolutePath!;

                    // 检查目录是否存在
                    if (!fs.existsSync(absoluteWorkingDir)) {
                        return createErrorResult(`工作目录不存在: ${absoluteWorkingDir}`);
                    }

                    if (!fs.statSync(absoluteWorkingDir).isDirectory()) {
                        return createErrorResult(`路径不是目录: ${absoluteWorkingDir}`);
                    }

                    workingDir = absoluteWorkingDir;
                }

                // 执行命令
                const { stdout, stderr } = await execAsync(command, {
                    cwd: workingDir || process.cwd(),
                    env: process.env,
                    timeout: timeout,
                    maxBuffer: 10 * 1024 * 1024 // 10MB buffer
                });

                const result = [];

                if (stdout.trim()) {
                    result.push(createTextContent(stdout.trim()));
                }

                if (stderr.trim()) {
                    result.push(createTextContent(`stderr:\n${stderr.trim()}`));
                }

                return createSuccessResult(...result);

            } catch (error: any) {
                logger.error(`Error executing command "${command}": ${error.message}`);

                const errorDetails = [
                    createTextContent(`错误: ${error.message}`)
                ];

                if (error.stdout?.trim()) {
                    errorDetails.push(createTextContent(`stdout:\n${error.stdout.trim()}`));
                }

                if (error.stderr?.trim()) {
                    errorDetails.push(createTextContent(`stderr:\n${error.stderr.trim()}`));
                }

                return {
                    content: errorDetails,
                    isError: true
                };
            }
        }
    });
}

/**
 * 创建执行脚本文件的工具
 */
export function createExecuteScriptTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'execute_script',
        description: '执行脚本文件（支持 Python、Shell、Node.js、TypeScript 等）。会根据文件扩展名自动选择解释器。注意：脚本路径必须是绝对路径。',
        schema: z.object({
            scriptPath: z.string().describe('脚本文件的绝对路径（如 /path/to/script.py, /path/to/script.sh）'),
            args: z.array(z.string()).optional().describe('传递给脚本的参数列表'),
            workingDir: z.string().optional().describe('可选的工作目录绝对路径，默认为脚本所在目录'),
            timeout: z.number().optional().default(60000).describe('超时时间（毫秒），默认为 60000（60秒）')
        }) as any,
        func: async ({ scriptPath, args = [], workingDir, timeout = 60000 }: any): Promise<MCPToolResult> => {
            try {
                // 验证脚本路径
                const validation = validatePath(scriptPath);
                if (!validation.valid) {
                    return createErrorResult(validation.error!);
                }

                const absoluteScriptPath = validation.absolutePath!;

                // 检查脚本是否存在
                if (!fs.existsSync(absoluteScriptPath)) {
                    return createErrorResult(`脚本不存在: ${absoluteScriptPath}`);
                }

                // 检查是否为文件
                const stat = fs.statSync(absoluteScriptPath);
                if (!stat.isFile()) {
                    return createErrorResult(`路径不是文件: ${absoluteScriptPath}`);
                }

                // 确定工作目录
                let cwd = workingDir;
                if (workingDir) {
                    const workingDirValidation = validatePath(workingDir);
                    if (!workingDirValidation.valid) {
                        return createErrorResult(workingDirValidation.error!);
                    }
                    cwd = workingDirValidation.absolutePath!;

                    if (!fs.existsSync(cwd)) {
                        return createErrorResult(`工作目录不存在: ${cwd}`);
                    }

                    if (!fs.statSync(cwd).isDirectory()) {
                        return createErrorResult(`路径不是目录: ${cwd}`);
                    }
                } else {
                    // 默认使用脚本所在目录
                    cwd = path.dirname(absoluteScriptPath);
                }

                // 根据文件扩展名确定执行器
                const ext = path.extname(absoluteScriptPath).toLowerCase();
                let command = '';

                switch (ext) {
                    case '.py':
                        command = `python "${absoluteScriptPath}" ${args.join(' ')}`;
                        break;
                    case '.sh':
                    case '.bash':
                        command = `bash "${absoluteScriptPath}" ${args.join(' ')}`;
                        break;
                    case '.js':
                        command = `node "${absoluteScriptPath}" ${args.join(' ')}`;
                        break;
                    case '.ts':
                        command = `ts-node "${absoluteScriptPath}" ${args.join(' ')}`;
                        break;
                    case '.rb':
                        command = `ruby "${absoluteScriptPath}" ${args.join(' ')}`;
                        break;
                    case '.pl':
                        command = `perl "${absoluteScriptPath}" ${args.join(' ')}`;
                        break;
                    case '.php':
                        command = `php "${absoluteScriptPath}" ${args.join(' ')}`;
                        break;
                    default:
                        return createErrorResult(`不支持的脚本类型: ${ext}。支持的类型：.py, .sh, .bash, .js, .ts, .rb, .pl, .php`);
                }

                // 执行脚本
                const { stdout, stderr } = await execAsync(command, {
                    cwd: cwd,
                    env: process.env,
                    timeout: timeout,
                    maxBuffer: 10 * 1024 * 1024 // 10MB buffer
                });

                const result = [];

                if (stdout.trim()) {
                    result.push(createTextContent(stdout.trim()));
                }

                if (stderr.trim()) {
                    result.push(createTextContent(`stderr:\n${stderr.trim()}`));
                }

                return createSuccessResult(...result);

            } catch (error: any) {
                logger.error(`Error executing script "${scriptPath}": ${error.message}`);

                const errorDetails = [
                    createTextContent(`错误: ${error.message}`)
                ];

                if (error.stdout?.trim()) {
                    errorDetails.push(createTextContent(`stdout:\n${error.stdout.trim()}`));
                }

                if (error.stderr?.trim()) {
                    errorDetails.push(createTextContent(`stderr:\n${error.stderr.trim()}`));
                }

                return {
                    content: errorDetails,
                    isError: true
                };
            }
        }
    });
}

/**
 * 创建所有命令执行工具
 */
export function createCommandTools(): StructuredToolInterface[] {
    return [
        createExecuteCommandTool(),
        createExecuteScriptTool()
    ];
}
