import fs from 'fs';
import path from 'path';
import ExcelJS from 'exceljs';

export interface TableSchema {
    name: string;
    filePath: string;
    sheetName: string;
    columns: string[];
    tags: string[];
    types: Record<string, string>;
    defaults: Record<string, string>;
    metadata: Record<string, string[]>;
}

export interface TableRow {
    _rowNumber: number;
    [column: string]: string | number;
}

export interface ParsedTable {
    schema: TableSchema;
    rows: TableRow[];
}

export function cellToString(cell: ExcelJS.Cell): string {
    const v = cell.value;
    if (v == null) return '';
    if (typeof v === 'object' && 'richText' in v) {
        return (v as ExcelJS.CellRichTextValue).richText.map(r => r.text).join('');
    }
    if (v instanceof Date) {
        return v.toISOString();
    }
    return String(v);
}

export function parseSheet(worksheet: ExcelJS.Worksheet, filePath: string): ParsedTable | null {
    const rawName = worksheet.name;
    if (rawName.startsWith('!')) return null;

    const name = rawName.startsWith('#') ? rawName.slice(1) : rawName;

    const columns: string[] = [];
    const tags: string[] = [];
    const columnIndices: Record<string, number> = {};
    const tagIndices: Record<string, number> = {};
    const types: Record<string, string> = {};
    const defaults: Record<string, string> = {};
    const metadata: Record<string, string[]> = {};

    let dataStartRow = -1;
    let dataEndRow = -1;
    let nameRowFound = false;
    let typeRowFound = false;
    let defaultRowFound = false;

    const rowCount = worksheet.rowCount;

    for (let r = 1; r <= rowCount; r++) {
        const row = worksheet.getRow(r);
        const marker = cellToString(row.getCell(1));

        if (marker.startsWith('/')) {
            if (marker === '/Name') {
                nameRowFound = true;
                for (let c = 2; c <= row.cellCount; c++) {
                    const colName = cellToString(row.getCell(c));
                    if (!colName) break;
                    if (colName.startsWith('!')) continue;
                    if (colName.startsWith('#')) {
                        tags.push(colName);
                        tagIndices[colName] = c;
                    } else {
                        columns.push(colName);
                        columnIndices[colName] = c;
                    }
                }
            } else if (marker === '/Type') {
                typeRowFound = true;
                for (const col of columns) {
                    const idx = columnIndices[col];
                    const raw = cellToString(row.getCell(idx));
                    if (raw.startsWith('#')) {
                        types[col] = raw;
                    } else {
                        types[col] = raw.toUpperCase();
                    }
                }
            } else if (marker === '/Default') {
                defaultRowFound = true;
                for (const col of columns) {
                    const idx = columnIndices[col];
                    defaults[col] = cellToString(row.getCell(idx));
                }
            } else if (marker === '/Begin') {
                dataStartRow = r + 1;
            } else if (marker === '/End') {
                dataEndRow = r - 1;
                break;
            } else {
                const values: string[] = [];
                for (let c = 2; c <= row.cellCount; c++) {
                    values.push(cellToString(row.getCell(c)));
                }
                metadata[marker] = values;
            }
        }
    }

    if (!nameRowFound || columns.length === 0) return null;
    if (dataStartRow < 0) return null;
    if (dataEndRow < 0) dataEndRow = rowCount;

    const rows: TableRow[] = [];
    for (let r = dataStartRow; r <= dataEndRow; r++) {
        const row = worksheet.getRow(r);
        const firstCell = cellToString(row.getCell(1));
        if (firstCell === '/End') break;

        const obj: TableRow = { _rowNumber: r };
        let hasValue = false;

        for (const col of columns) {
            const val = cellToString(row.getCell(columnIndices[col]));
            obj[col] = val;
            if (val) hasValue = true;
        }
        for (const tag of tags) {
            obj[tag] = cellToString(row.getCell(tagIndices[tag]));
        }

        if (hasValue) rows.push(obj);
    }

    return {
        schema: { name, filePath, sheetName: rawName, columns, tags, types, defaults, metadata },
        rows,
    };
}

export async function parseWorkbook(filePath: string): Promise<ParsedTable[]> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const tables: ParsedTable[] = [];
    workbook.eachSheet((ws) => {
        const parsed = parseSheet(ws, filePath);
        if (parsed) tables.push(parsed);
    });
    return tables;
}

const SKIP_FILES = new Set(['l10n_data.xlsx']);

export async function scanDir(dir: string): Promise<ParsedTable[]> {
    if (!fs.existsSync(dir)) throw new Error(`Directory not found: ${dir}`);

    const files = fs.readdirSync(dir).filter(f =>
        (f.endsWith('.xlsx') || f.endsWith('.xlsm')) &&
        !f.startsWith('~$') &&
        !SKIP_FILES.has(f)
    );

    const allTables: ParsedTable[] = [];
    for (const file of files) {
        const tables = await parseWorkbook(path.join(dir, file));
        allTables.push(...tables);
    }
    return allTables;
}

export async function findTable(dir: string, tableName: string): Promise<{ table: ParsedTable; workbook: ExcelJS.Workbook } | null> {
    const normalizedName = tableName.toLowerCase();
    const files = fs.readdirSync(dir).filter(f =>
        (f.endsWith('.xlsx') || f.endsWith('.xlsm')) &&
        !f.startsWith('~$') &&
        !SKIP_FILES.has(f)
    );

    for (const file of files) {
        const filePath = path.join(dir, file);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(filePath);

        let found: ParsedTable | null = null;
        workbook.eachSheet((ws) => {
            if (found) return;
            const parsed = parseSheet(ws, filePath);
            if (parsed && parsed.schema.name.toLowerCase() === normalizedName) {
                found = parsed;
            }
        });

        if (found) return { table: found, workbook };
    }
    return null;
}
