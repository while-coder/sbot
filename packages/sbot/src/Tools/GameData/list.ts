import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, type MCPToolResult } from 'scorpio.ai';
import { LoggerService } from '../../Core/LoggerService.js';
import { loadPrompt } from '../../Core/PromptLoader.js';
import { scanDir } from './parser.js';

const logger = LoggerService.getLogger('Tools/GameData/list');

export function createGameDataListTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'gamedata_list',
        description: loadPrompt('tools/gamedata/list.txt'),
        schema: z.object({
            dir: z.string().describe('Excel 数据目录的绝对路径'),
        }) as any,
        func: async ({ dir }: any): Promise<MCPToolResult> => {
            try {
                const tables = await scanDir(dir);
                if (tables.length === 0) {
                    return createSuccessResult(createTextContent(`目录 ${dir} 下没有找到有效的游戏数据表。`));
                }

                const lines: string[] = [`共 ${tables.length} 张表：`, ''];
                for (const t of tables) {
                    const { schema, rows } = t;
                    const colSummary = schema.columns.slice(0, 8).join(', ');
                    const extra = schema.columns.length > 8 ? `, ... (+${schema.columns.length - 8})` : '';
                    lines.push(`## ${schema.name}`);
                    lines.push(`- 来源: ${schema.filePath}`);
                    lines.push(`- 行数: ${rows.length}, 列数: ${schema.columns.length}`);
                    lines.push(`- 列: ${colSummary}${extra}`);
                    if (schema.tags.length > 0) {
                        lines.push(`- 标签列: ${schema.tags.join(', ')}`);
                    }
                    lines.push('');
                }
                return createSuccessResult(createTextContent(lines.join('\n')));
            } catch (e: any) {
                logger.error(`gamedata_list failed: ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}
