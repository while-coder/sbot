/**
 * Bash 命令执行工具
 * 提供通用的命令行执行能力，支持工作目录、超时等参数
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { loadPrompt } from '../_prompts/index';

const logger = LoggerService.getLogger('Tools/Bash/index.ts');
const execAsync = promisify(exec);

const MAX_OUTPUT_LINES = 2000;
const MAX_OUTPUT_BYTES = 512 * 1024; // 512KB

/**
 * 截断输出：超过行数或字节数限制时截断
 */
function truncateOutput(output: string): { text: string; truncated: boolean } {
    const lines = output.split('\n');
    let truncated = false;

    if (lines.length > MAX_OUTPUT_LINES) {
        truncated = true;
        const kept = lines.slice(0, MAX_OUTPUT_LINES);
        return {
            text: kept.join('\n') + `\n\n[输出已截断，共 ${lines.length} 行，仅显示前 ${MAX_OUTPUT_LINES} 行]`,
            truncated,
        };
    }

    if (Buffer.byteLength(output, 'utf-8') > MAX_OUTPUT_BYTES) {
        truncated = true;
        let byteCount = 0;
        let lineCount = 0;
        for (const line of lines) {
            byteCount += Buffer.byteLength(line, 'utf-8') + 1;
            if (byteCount > MAX_OUTPUT_BYTES) break;
            lineCount++;
        }
        const kept = lines.slice(0, lineCount);
        return {
            text: kept.join('\n') + `\n\n[输出已截断，超过 ${MAX_OUTPUT_BYTES} 字节限制]`,
            truncated,
        };
    }

    return { text: output, truncated: false };
}

/**
 * 创建 bash 命令执行工具
 */
export function createBashTool(): StructuredToolInterface {
    const description = loadPrompt('bash')
        .replace('${directory}', process.cwd())
        .replace('${maxLines}', String(MAX_OUTPUT_LINES))
        .replace('${maxBytes}', String(MAX_OUTPUT_BYTES))
        || '执行 bash 命令';

    return new DynamicStructuredTool({
        name: 'bash',
        description,
        schema: z.object({
            command: z.string().describe('要执行的命令'),
            workdir: z.string().optional().describe('工作目录绝对路径，默认为当前目录'),
            timeout: z.number().optional().default(120000).describe('超时时间（毫秒），默认 120000'),
            description: z.string().optional().describe('命令用途的简短描述（5-10 词）'),
        }) as any,
        func: async ({ command, workdir, timeout = 120000 }: any): Promise<MCPToolResult> => {
            try {
                // 解析工作目录
                let cwd = process.cwd();
                if (workdir) {
                    if (!path.isAbsolute(workdir)) {
                        return createErrorResult(`工作目录必须是绝对路径: ${workdir}`);
                    }
                    const normalized = path.normalize(workdir);
                    if (!fs.existsSync(normalized)) {
                        return createErrorResult(`工作目录不存在: ${normalized}`);
                    }
                    if (!fs.statSync(normalized).isDirectory()) {
                        return createErrorResult(`路径不是目录: ${normalized}`);
                    }
                    cwd = normalized;
                }

                const { stdout, stderr } = await execAsync(command, {
                    cwd,
                    env: process.env,
                    timeout,
                    maxBuffer: 10 * 1024 * 1024,
                    shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/bash',
                });

                const parts: any[] = [];
                if (stdout.trim()) {
                    const { text } = truncateOutput(stdout.trim());
                    parts.push(createTextContent(text));
                }
                if (stderr.trim()) {
                    const { text } = truncateOutput(stderr.trim());
                    parts.push(createTextContent(`stderr:\n${text}`));
                }

                if (parts.length === 0) {
                    parts.push(createTextContent('命令执行成功（无输出）'));
                }

                return createSuccessResult(...parts);
            } catch (error: any) {
                logger.error(`bash command error: ${error.message}`);
                const details: any[] = [createTextContent(`错误: ${error.message}`)];
                if (error.stdout?.trim()) {
                    const { text } = truncateOutput(error.stdout.trim());
                    details.push(createTextContent(`stdout:\n${text}`));
                }
                if (error.stderr?.trim()) {
                    const { text } = truncateOutput(error.stderr.trim());
                    details.push(createTextContent(`stderr:\n${text}`));
                }
                return { content: details, isError: true };
            }
        },
    });
}

/**
 * 创建所有 Bash 工具
 */
export function createBashTools(): StructuredToolInterface[] {
    return [createBashTool()];
}
