import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, type MCPToolResult } from 'scorpio.ai';
import { LoggerService } from '../../Core/LoggerService.js';
import { loadPrompt } from '../../Core/PromptLoader.js';
import { findTable, cellToString } from './parser.js';

const logger = LoggerService.getLogger('Tools/GameData/update');

export function createGameDataUpdateTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'gamedata_update',
        description: loadPrompt('tools/gamedata/update.txt'),
        schema: z.object({
            dir: z.string().describe('Excel 数据目录的绝对路径'),
            table: z.string().describe('表名'),
            id: z.string().describe('行的 ID 值'),
            updates: z.string().describe('要修改的字段，JSON 格式，如 {"Name": "test", "Desc": "测试"}'),
        }) as any,
        func: async ({ dir, table, id, updates: updatesStr }: any): Promise<MCPToolResult> => {
            try {
                let updateMap: Record<string, string>;
                try {
                    updateMap = JSON.parse(updatesStr);
                } catch {
                    return createErrorResult(`updates 参数 JSON 解析失败: ${updatesStr}`);
                }

                const result = await findTable(dir, table);
                if (!result) return createErrorResult(`表 "${table}" 未找到。`);

                const { table: parsedTable, workbook } = result;
                const { schema } = parsedTable;

                // 验证字段存在
                for (const field of Object.keys(updateMap)) {
                    if (!schema.columns.includes(field)) {
                        return createErrorResult(`字段 "${field}" 不存在于表 "${schema.name}" 中。可用字段: ${schema.columns.join(', ')}`);
                    }
                }

                // 找到目标行
                const targetRow = parsedTable.rows.find(r => String(r['ID'] ?? '') === String(id));
                if (!targetRow) {
                    return createErrorResult(`在表 "${schema.name}" 中未找到 ID=${id} 的行。`);
                }

                const rowNumber = targetRow._rowNumber;
                const worksheet = workbook.getWorksheet(schema.sheetName);
                if (!worksheet) {
                    return createErrorResult(`工作表 "${schema.sheetName}" 未找到。`);
                }

                // 构建列名→列号映射
                const nameRow = findMetadataRow(worksheet, '/Name');
                if (!nameRow) return createErrorResult('无法定位 /Name 行。');

                const colIndexMap: Record<string, number> = {};
                for (let c = 2; c <= nameRow.cellCount; c++) {
                    const colName = cellToString(nameRow.getCell(c));
                    if (!colName) break;
                    if (!colName.startsWith('!') && !colName.startsWith('#')) {
                        colIndexMap[colName] = c;
                    }
                }

                // 执行修改
                const excelRow = worksheet.getRow(rowNumber);
                const changes: string[] = [];

                for (const [field, newValue] of Object.entries(updateMap)) {
                    const colIdx = colIndexMap[field];
                    if (!colIdx) continue;

                    const oldValue = cellToString(excelRow.getCell(colIdx));
                    excelRow.getCell(colIdx).value = newValue;
                    changes.push(`- ${field}: "${oldValue}" → "${newValue}"`);
                }

                excelRow.commit();
                await workbook.xlsx.writeFile(schema.filePath);

                const lines = [
                    `已修改表 "${schema.name}" ID=${id}（行 ${rowNumber}）:`,
                    '',
                    ...changes,
                ];
                return createSuccessResult(createTextContent(lines.join('\n')));
            } catch (e: any) {
                logger.error(`gamedata_update failed: ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}

function findMetadataRow(worksheet: any, marker: string) {
    for (let r = 1; r <= worksheet.rowCount; r++) {
        const row = worksheet.getRow(r);
        if (cellToString(row.getCell(1)) === marker) return row;
    }
    return null;
}
