import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, type MCPToolResult } from 'scorpio.ai';
import { LoggerService } from '../../Core/LoggerService.js';
import { loadPrompt } from '../../Core/PromptLoader.js';
import { scanDir, findTable, type ParsedTable, type TableRow } from './parser.js';

const logger = LoggerService.getLogger('Tools/GameData/query');

function matchRow(row: TableRow, field: string, value: string, operator: string): boolean {
    const cellVal = String(row[field] ?? '');
    switch (operator) {
        case 'eq': return cellVal === value;
        case 'contains': return cellVal.toLowerCase().includes(value.toLowerCase());
        case 'gt': return Number(cellVal) > Number(value);
        case 'lt': return Number(cellVal) < Number(value);
        default: return cellVal === value;
    }
}

function formatRows(tableName: string, rows: TableRow[], columns: string[]): string {
    if (rows.length === 0) return '';

    const lines: string[] = [`### ${tableName} (${rows.length} 条匹配)`];

    // 表头
    const displayCols = ['_rowNumber', ...columns];
    lines.push('| 行号 | ' + columns.join(' | ') + ' |');
    lines.push('|---' + columns.map(() => '|---').join('') + '|');

    for (const row of rows) {
        const vals = displayCols.map(c => {
            const v = String(row[c] ?? '');
            return v.length > 40 ? v.slice(0, 37) + '...' : v;
        });
        lines.push('| ' + vals.join(' | ') + ' |');
    }
    return lines.join('\n');
}

export function createGameDataQueryTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'gamedata_query',
        description: loadPrompt('tools/gamedata/query.txt'),
        schema: z.object({
            dir: z.string().describe('Excel 数据目录的绝对路径'),
            table: z.string().optional().describe('表名，不填则搜索所有表'),
            field: z.string().describe('要查询的字段名，如 ID, Name, ItemID'),
            value: z.string().describe('要匹配的值'),
            operator: z.enum(['eq', 'contains', 'gt', 'lt']).default('eq')
                .describe('匹配方式: eq=精确匹配, contains=包含, gt=大于, lt=小于'),
            limit: z.number().default(20).describe('最多返回行数'),
        }) as any,
        func: async ({ dir, table, field, value, operator = 'eq', limit = 20 }: any): Promise<MCPToolResult> => {
            try {
                let tablesToSearch: ParsedTable[];

                if (table) {
                    const result = await findTable(dir, table);
                    if (!result) return createErrorResult(`表 "${table}" 未找到。`);
                    tablesToSearch = [result.table];
                } else {
                    tablesToSearch = await scanDir(dir);
                }

                const sections: string[] = [];
                let totalMatches = 0;

                for (const t of tablesToSearch) {
                    // 检查字段是否存在
                    const allFields = [...t.schema.columns, ...t.schema.tags];
                    if (!allFields.includes(field)) continue;

                    const remaining = limit - totalMatches;
                    if (remaining <= 0) break;

                    const matched = t.rows.filter(r => matchRow(r, field, value, operator)).slice(0, remaining);
                    if (matched.length > 0) {
                        sections.push(formatRows(t.schema.name, matched, t.schema.columns));
                        totalMatches += matched.length;
                    }
                }

                if (totalMatches === 0) {
                    return createSuccessResult(createTextContent(
                        `未找到 ${field} ${operator} "${value}" 的匹配行${table ? `（表: ${table}）` : ''}。`
                    ));
                }

                const header = `共找到 ${totalMatches} 条匹配（${operator}: ${field} = "${value}"）\n\n`;
                return createSuccessResult(createTextContent(header + sections.join('\n\n')));
            } catch (e: any) {
                logger.error(`gamedata_query failed: ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}
