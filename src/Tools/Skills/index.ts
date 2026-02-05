/**
 * Skills 工具集
 * 提供读取 skill 文件和执行 skill 脚本的工具
 */

import fs from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from '../ToolsConfig';

const logger = LoggerService.getLogger('Tools/Skills/index.ts');
const execAsync = promisify(exec);

/**
 * 创建读取 skill 文件的工具
 * @param skillsDir skills 目录路径
 */
export function createReadSkillFileTool(skillsDir: string): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'read_skill_file',
        description: '读取 skill 目录下的文件内容。用于读取 SKILL.md、scripts/、references/、assets/ 等目录下的文件。',
        schema: z.object({
            skillName: z.string().describe('skill 名称（kebab-case 格式）'),
            filePath: z.string().describe('skill 目录内的相对路径，例如："SKILL.md"、"scripts/init.py"、"references/api.md"')
        }) as any,
        func: async ({ skillName, filePath }: any): Promise<MCPToolResult> => {
            try {
                // 构建完整路径
                const fullPath = path.join(skillsDir, skillName, filePath);

                // 安全检查：确保路径在 skills 目录内
                const normalizedPath = path.normalize(fullPath);
                const normalizedSkillsDir = path.normalize(skillsDir);
                if (!normalizedPath.startsWith(normalizedSkillsDir)) {
                    return createErrorResult('安全错误：不允许访问 skills 目录之外的文件');
                }

                // 检查文件是否存在
                if (!fs.existsSync(fullPath)) {
                    return createErrorResult(`文件不存在: ${filePath}`);
                }

                // 检查是否为文件
                const stat = fs.statSync(fullPath);
                if (!stat.isFile()) {
                    return createErrorResult(`路径不是文件: ${filePath}`);
                }

                // 读取文件内容
                const content = fs.readFileSync(fullPath, 'utf-8');

                logger.info(`Read skill file: ${skillName}/${filePath}`);

                return createSuccessResult(
                    createTextContent(`Skill文件读取成功: ${skillName}/${filePath}`),
                    createTextContent(content)
                );

            } catch (error: any) {
                logger.error(`Error reading skill file ${skillName}/${filePath}: ${error.message}`);
                return createErrorResult(error.message);
            }
        }
    });
}

/**
 * 创建执行 skill 脚本的工具
 * @param skillsDir skills 目录路径
 */
export function createExecuteSkillScriptTool(skillsDir: string): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'execute_skill_script',
        description: '执行 skill 目录下的脚本文件（支持 Python、Shell、Node.js 等）。脚本会在 skill 目录下执行。',
        schema: z.object({
            skillName: z.string().describe('skill 名称（kebab-case 格式）'),
            scriptPath: z.string().describe('脚本文件的相对路径，例如："scripts/process.py"、"scripts/build.sh"'),
            args: z.array(z.string()).optional().describe('传递给脚本的参数列表')
        }) as any,
        func: async ({ skillName, scriptPath, args = [] }: any): Promise<MCPToolResult> => {
            try {
                // 构建完整路径
                const fullPath = path.join(skillsDir, skillName, scriptPath);
                const skillDir = path.join(skillsDir, skillName);

                // 安全检查：确保路径在 skills 目录内
                const normalizedPath = path.normalize(fullPath);
                const normalizedSkillsDir = path.normalize(skillsDir);
                if (!normalizedPath.startsWith(normalizedSkillsDir)) {
                    return createErrorResult('安全错误：不允许执行 skills 目录之外的脚本');
                }

                // 检查脚本是否存在
                if (!fs.existsSync(fullPath)) {
                    return createErrorResult(`脚本不存在: ${scriptPath}`);
                }

                // 根据文件扩展名确定执行器
                const ext = path.extname(scriptPath).toLowerCase();
                let command = '';

                switch (ext) {
                    case '.py':
                        command = `python "${fullPath}" ${args.join(' ')}`;
                        break;
                    case '.sh':
                        command = `bash "${fullPath}" ${args.join(' ')}`;
                        break;
                    case '.js':
                        command = `node "${fullPath}" ${args.join(' ')}`;
                        break;
                    case '.ts':
                        command = `ts-node "${fullPath}" ${args.join(' ')}`;
                        break;
                    default:
                        return createErrorResult(`不支持的脚本类型: ${ext}。支持的类型：.py, .sh, .js, .ts`);
                }

                // 执行脚本
                const { stdout, stderr } = await execAsync(command, {
                    cwd: skillDir, // 在 skill 目录下执行
                    env: process.env,
                    timeout: 60000, // 60 秒超时
                    maxBuffer: 10 * 1024 * 1024 // 10MB buffer
                });

                logger.info(`Executed skill script: ${skillName}/${scriptPath}`);

                const result = [
                    createTextContent(`脚本执行成功: ${skillName}/${scriptPath}`)
                ];

                if (stdout.trim()) {
                    result.push(createTextContent(`输出:\n${stdout.trim()}`));
                }

                if (stderr.trim()) {
                    result.push(createTextContent(`错误输出:\n${stderr.trim()}`));
                }

                return createSuccessResult(...result);

            } catch (error: any) {
                logger.error(`Error executing skill script ${skillName}/${scriptPath}: ${error.message}`);

                const errorDetails = [
                    createTextContent(`脚本执行失败: ${error.message}`)
                ];

                if (error.stdout?.trim()) {
                    errorDetails.push(createTextContent(`输出:\n${error.stdout.trim()}`));
                }

                if (error.stderr?.trim()) {
                    errorDetails.push(createTextContent(`错误输出:\n${error.stderr.trim()}`));
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
 * 创建列出 skill 目录结构的工具
 * @param skillsDir skills 目录路径
 */
export function createListSkillFilesTool(skillsDir: string): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'list_skill_files',
        description: '列出指定 skill 目录下的所有文件和子目录结构。用于了解 skill 包含哪些文件和资源。',
        schema: z.object({
            skillName: z.string().describe('skill 名称（kebab-case 格式）'),
            subPath: z.string().optional().describe('可选的子路径，例如："scripts"、"references"')
        }) as any,
        func: async ({ skillName, subPath = '' }: any): Promise<MCPToolResult> => {
            try {
                // 构建完整路径
                const fullPath = path.join(skillsDir, skillName, subPath);

                // 安全检查
                const normalizedPath = path.normalize(fullPath);
                const normalizedSkillsDir = path.normalize(skillsDir);
                if (!normalizedPath.startsWith(normalizedSkillsDir)) {
                    return createErrorResult('安全错误：不允许访问 skills 目录之外的文件');
                }

                // 检查目录是否存在
                if (!fs.existsSync(fullPath)) {
                    return createErrorResult(`目录不存在: ${subPath || '/'}`);
                }

                // 递归读取目录结构
                const getDirectoryStructure = (dirPath: string, prefix = ''): string[] => {
                    const items: string[] = [];
                    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

                    entries.forEach((entry, index) => {
                        const isLast = index === entries.length - 1;
                        const marker = isLast ? '└─' : '├─';
                        const nextPrefix = prefix + (isLast ? '  ' : '│ ');

                        if (entry.isDirectory()) {
                            items.push(`${prefix}${marker} ${entry.name}/`);
                            const subItems = getDirectoryStructure(
                                path.join(dirPath, entry.name),
                                nextPrefix
                            );
                            items.push(...subItems);
                        } else {
                            const filePath = path.join(dirPath, entry.name);
                            const stat = fs.statSync(filePath);
                            const size = stat.size;
                            const sizeStr = size > 1024 ? `${(size / 1024).toFixed(1)}KB` : `${size}B`;
                            items.push(`${prefix}${marker} ${entry.name} (${sizeStr})`);
                        }
                    });

                    return items;
                };

                const structure = getDirectoryStructure(fullPath);
                const displayPath = subPath || '/';

                logger.info(`Listed skill files: ${skillName}/${displayPath}`);

                return createSuccessResult(
                    createTextContent(`Skill目录结构: ${skillName}/${displayPath}`),
                    createTextContent(structure.join('\n'))
                );

            } catch (error: any) {
                logger.error(`Error listing skill files ${skillName}/${subPath}: ${error.message}`);
                return createErrorResult(error.message);
            }
        }
    });
}

/**
 * 创建所有 skill 相关工具
 * @param skillsDir skills 目录路径
 */
export function createSkillTools(skillsDir: string): StructuredToolInterface[] {
    return [
        createReadSkillFileTool(skillsDir),
        createExecuteSkillScriptTool(skillsDir),
        createListSkillFilesTool(skillsDir)
    ];
}
