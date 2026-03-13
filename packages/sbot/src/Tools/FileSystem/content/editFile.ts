import fsAsync from 'fs/promises';
import { createTwoFilesPatch } from 'diff';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { checkFile, normalizeLineEndings, writeAtomic } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/content/editFile.ts');

interface FileEdit { oldText: string; newText: string; useRegex?: boolean; regexFlags?: string; }

async function applyFileEdits(filePath: string, edits: FileEdit[], dryRun = false): Promise<string> {
    const content = normalizeLineEndings(await fsAsync.readFile(filePath, 'utf-8'));
    let modified = content;
    for (const edit of edits) {
        const newN = normalizeLineEndings(edit.newText);
        if (edit.useRegex) {
            const regex = new RegExp(edit.oldText, edit.regexFlags ?? 'g');
            if (!modified.match(regex)) throw new Error(`正则表达式无匹配: ${edit.oldText}`);
            modified = modified.replace(regex, newN);
            continue;
        }
        const oldN = normalizeLineEndings(edit.oldText);
        if (modified.includes(oldN)) {
            modified = modified.replace(oldN, newN);
            continue;
        }
        const oldLines = oldN.split('\n');
        const contentLines = modified.split('\n');
        let matched = false;
        for (let i = 0; i <= contentLines.length - oldLines.length; i++) {
            if (!oldLines.every((ol, j) => ol.trim() === contentLines[i + j].trim())) continue;
            const origIndent = contentLines[i].match(/^\s*/)?.[0] ?? '';
            const newLines = newN.split('\n').map((line, j) => {
                if (j === 0) return origIndent + line.trimStart();
                const oldIndent = oldLines[j]?.match(/^\s*/)?.[0] ?? '';
                const ni = line.match(/^\s*/)?.[0] ?? '';
                if (oldIndent && ni) {
                    return origIndent + ' '.repeat(Math.max(0, ni.length - oldIndent.length)) + line.trimStart();
                }
                return line;
            });
            contentLines.splice(i, oldLines.length, ...newLines);
            modified = contentLines.join('\n');
            matched = true;
            break;
        }
        if (!matched) throw new Error(`找不到匹配的文本:\n${edit.oldText}`);
    }
    const diff = createTwoFilesPatch(filePath, filePath, content, modified, 'original', 'modified');
    let ticks = 3;
    while (diff.includes('`'.repeat(ticks))) ticks++;
    const formatted = `${'`'.repeat(ticks)}diff\n${diff}${'`'.repeat(ticks)}\n\n`;
    if (!dryRun) await writeAtomic(filePath, modified, 'utf-8');
    return formatted;
}

/** 精确文本编辑（支持多处替换 + 模糊空白匹配 + 正则 + unified diff 输出）*/
export function createEditFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'edit_file',
        description: '对文件进行精确的文本替换编辑。支持多处修改、正则替换（useRegex）、模糊空白匹配、dry-run 预览，返回 unified diff。路径必须是绝对路径。',
        schema: z.object({
            filePath: z.string().describe('要编辑的文件的绝对路径'),
            edits: z.array(z.object({
                oldText: z.string().describe('要替换的原始文本；useRegex=true 时为正则表达式模式'),
                newText: z.string().describe('替换后的新文本'),
                useRegex: z.boolean().optional().default(false).describe('将 oldText 作为正则表达式，默认 false'),
                regexFlags: z.string().optional().default('g').describe('正则标志，默认 g（全局替换），仅 useRegex=true 时生效'),
            })).describe('编辑操作列表，按顺序依次应用'),
            dryRun: z.boolean().optional().default(false).describe('仅预览 diff，不实际写入文件，默认 false'),
        }) as any,
        func: async ({ filePath, edits, dryRun = false }: any): Promise<MCPToolResult> => {
            try {
                const { abs } = checkFile(filePath);
                return createSuccessResult(createTextContent(await applyFileEdits(abs, edits, dryRun)));
            } catch (e: any) {
                logger.error(`edit_file ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
