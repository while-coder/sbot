import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, type MCPToolResult } from 'scorpio.ai';
import { LoggerService } from '../../Core/LoggerService.js';
import { loadPrompt } from '../../Core/PromptLoader.js';
import { findTable } from './parser.js';

const logger = LoggerService.getLogger('Tools/GameData/schema');

export function createGameDataSchemaTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'gamedata_schema',
        description: loadPrompt('tools/gamedata/schema.txt'),
        schema: z.object({
            dir: z.string().describe('Excel 数据目录的绝对路径'),
            table: z.string().describe('表名（sheet 名，不区分大小写）'),
        }) as any,
        func: async ({ dir, table }: any): Promise<MCPToolResult> => {
            try {
                const result = await findTable(dir, table);
                if (!result) {
                    return createErrorResult(`表 "${table}" 未找到。`);
                }

                const { schema } = result.table;
                const lines: string[] = [
                    `# ${schema.name}`,
                    `- 来源: ${schema.filePath} (sheet: ${schema.sheetName})`,
                    '',
                    '| 列名 | 类型 | 默认值 |',
                    '|------|------|--------|',
                ];

                for (const col of schema.columns) {
                    const type = schema.types[col] || '-';
                    const def = schema.defaults[col] || '-';
                    lines.push(`| ${col} | ${type} | ${def} |`);
                }

                if (schema.tags.length > 0) {
                    lines.push('', `标签列: ${schema.tags.join(', ')}`);
                }

                const metaKeys = Object.keys(schema.metadata);
                if (metaKeys.length > 0) {
                    lines.push('', '元数据:');
                    for (const key of metaKeys) {
                        const vals = schema.metadata[key].filter(v => v).join(', ');
                        if (vals) lines.push(`- ${key}: ${vals}`);
                        else lines.push(`- ${key}`);
                    }
                }

                return createSuccessResult(createTextContent(lines.join('\n')));
            } catch (e: any) {
                logger.error(`gamedata_schema failed: ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}
