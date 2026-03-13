import fsAsync from 'fs/promises';
import { createTwoFilesPatch } from 'diff';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { checkFile, normalizeLineEndings, writeAtomic } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/content/edit.ts');

interface FileEdit { oldText: string; newText: string; useRegex?: boolean; regexFlags?: string; replaceAll?: boolean; }

// ─── Replace engine（来源：opencode/cline，9 级渐进 fallback）─────────────────

type Replacer = (content: string, find: string) => Generator<string, void, unknown>;

function levenshtein(a: string, b: string): number {
    if (a === '' || b === '') return Math.max(a.length, b.length);
    const m = Array.from({ length: a.length + 1 }, (_, i) =>
        Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
    );
    for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + cost);
        }
    return m[a.length][b.length];
}

// 1. 精确匹配
const SimpleReplacer: Replacer = function* (_content, find) { yield find; };

// 2. 逐行 trim 匹配（返回原始文本片段）
const LineTrimmedReplacer: Replacer = function* (content, find) {
    const origLines = content.split('\n');
    const searchLines = find.split('\n');
    if (searchLines[searchLines.length - 1] === '') searchLines.pop();
    for (let i = 0; i <= origLines.length - searchLines.length; i++) {
        if (!searchLines.every((sl, j) => origLines[i + j].trim() === sl.trim())) continue;
        let start = 0;
        for (let k = 0; k < i; k++) start += origLines[k].length + 1;
        let end = start;
        for (let k = 0; k < searchLines.length; k++) {
            end += origLines[i + k].length;
            if (k < searchLines.length - 1) end += 1;
        }
        yield content.substring(start, end);
    }
};

// 3. 块锚点 + Levenshtein 相似度（首行/末行定位，中间行打分）
const BlockAnchorReplacer: Replacer = function* (content, find) {
    const origLines = content.split('\n');
    const searchLines = find.split('\n');
    if (searchLines.length < 3) return;
    if (searchLines[searchLines.length - 1] === '') searchLines.pop();

    const firstLine = searchLines[0].trim();
    const lastLine = searchLines[searchLines.length - 1].trim();
    const searchSize = searchLines.length;

    const candidates: Array<{ s: number; e: number }> = [];
    for (let i = 0; i < origLines.length; i++) {
        if (origLines[i].trim() !== firstLine) continue;
        for (let j = i + 2; j < origLines.length; j++) {
            if (origLines[j].trim() === lastLine) { candidates.push({ s: i, e: j }); break; }
        }
    }
    if (candidates.length === 0) return;

    const calcSim = (s: number, e: number) => {
        const blockSize = e - s + 1;
        const linesToCheck = Math.min(searchSize - 2, blockSize - 2);
        if (linesToCheck <= 0) return 1.0;
        let sim = 0;
        for (let j = 1; j < searchSize - 1 && j < blockSize - 1; j++) {
            const ol = origLines[s + j].trim(), sl = searchLines[j].trim();
            const maxLen = Math.max(ol.length, sl.length);
            if (maxLen > 0) sim += (1 - levenshtein(ol, sl) / maxLen) / linesToCheck;
        }
        return sim;
    };

    const yieldMatch = (s: number, e: number) => {
        let start = 0;
        for (let k = 0; k < s; k++) start += origLines[k].length + 1;
        let end = start;
        for (let k = s; k <= e; k++) { end += origLines[k].length; if (k < e) end += 1; }
        return content.substring(start, end);
    };

    if (candidates.length === 1) {
        if (calcSim(candidates[0].s, candidates[0].e) >= 0.0) yield yieldMatch(candidates[0].s, candidates[0].e);
        return;
    }
    let best: { s: number; e: number } | null = null, maxSim = -1;
    for (const c of candidates) {
        const sim = calcSim(c.s, c.e);
        if (sim > maxSim) { maxSim = sim; best = c; }
    }
    if (maxSim >= 0.3 && best) yield yieldMatch(best.s, best.e);
};

// 4. 全空白标准化匹配
const WhitespaceNormalizedReplacer: Replacer = function* (content, find) {
    const norm = (t: string) => t.replace(/\s+/g, ' ').trim();
    const normFind = norm(find);
    const lines = content.split('\n');
    for (const line of lines) {
        if (norm(line) === normFind) { yield line; continue; }
        if (norm(line).includes(normFind)) {
            const pattern = find.trim().split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
            try { const m = line.match(new RegExp(pattern)); if (m) yield m[0]; } catch { /* skip */ }
        }
    }
    const findLines = find.split('\n');
    if (findLines.length > 1) {
        for (let i = 0; i <= lines.length - findLines.length; i++) {
            const block = lines.slice(i, i + findLines.length).join('\n');
            if (norm(block) === normFind) yield block;
        }
    }
};

// 5. 缩进弹性匹配（去除公共缩进后比较）
const IndentationFlexibleReplacer: Replacer = function* (content, find) {
    const removeIndent = (text: string) => {
        const ls = text.split('\n');
        const nonEmpty = ls.filter(l => l.trim().length > 0);
        if (nonEmpty.length === 0) return text;
        const min = Math.min(...nonEmpty.map(l => (l.match(/^(\s*)/) ?? ['', ''])[1].length));
        return ls.map(l => (l.trim().length === 0 ? l : l.slice(min))).join('\n');
    };
    const normFind = removeIndent(find);
    const contentLines = content.split('\n');
    const findLines = find.split('\n');
    for (let i = 0; i <= contentLines.length - findLines.length; i++) {
        const block = contentLines.slice(i, i + findLines.length).join('\n');
        if (removeIndent(block) === normFind) yield block;
    }
};

// 6. 转义字符标准化匹配
const EscapeNormalizedReplacer: Replacer = function* (content, find) {
    const unescape = (s: string) => s.replace(/\\(n|t|r|'|"|`|\\|\n|\$)/g, (_, c) =>
        ({ n: '\n', t: '\t', r: '\r', "'": "'", '"': '"', '`': '`', '\\': '\\', '\n': '\n', '$': '$' } as Record<string, string>)[c] ?? _,
    );
    const unescapedFind = unescape(find);
    if (content.includes(unescapedFind)) { yield unescapedFind; return; }
    const lines = content.split('\n');
    const findLines = unescapedFind.split('\n');
    for (let i = 0; i <= lines.length - findLines.length; i++) {
        const block = lines.slice(i, i + findLines.length).join('\n');
        if (unescape(block) === unescapedFind) yield block;
    }
};

// 7. 两端修剪后匹配
const TrimmedBoundaryReplacer: Replacer = function* (content, find) {
    const trimmed = find.trim();
    if (trimmed === find) return;
    if (content.includes(trimmed)) { yield trimmed; return; }
    const lines = content.split('\n');
    const findLines = find.split('\n');
    for (let i = 0; i <= lines.length - findLines.length; i++) {
        const block = lines.slice(i, i + findLines.length).join('\n');
        if (block.trim() === trimmed) yield block;
    }
};

// 8. 上下文感知匹配（首末行锚点 + 中间行 50% 相似阈值）
const ContextAwareReplacer: Replacer = function* (content, find) {
    const findLines = find.split('\n');
    if (findLines.length < 3) return;
    if (findLines[findLines.length - 1] === '') findLines.pop();
    const contentLines = content.split('\n');
    const firstLine = findLines[0].trim();
    const lastLine = findLines[findLines.length - 1].trim();
    for (let i = 0; i < contentLines.length; i++) {
        if (contentLines[i].trim() !== firstLine) continue;
        for (let j = i + 2; j < contentLines.length; j++) {
            if (contentLines[j].trim() !== lastLine) continue;
            const blockLines = contentLines.slice(i, j + 1);
            if (blockLines.length === findLines.length) {
                let matching = 0, total = 0;
                for (let k = 1; k < blockLines.length - 1; k++) {
                    const bl = blockLines[k].trim(), fl = findLines[k].trim();
                    if (bl.length > 0 || fl.length > 0) { total++; if (bl === fl) matching++; }
                }
                if (total === 0 || matching / total >= 0.5) { yield blockLines.join('\n'); break; }
            }
            break;
        }
    }
};

// 9. 多重精确匹配（配合 replaceAll 使用）
const MultiOccurrenceReplacer: Replacer = function* (content, find) {
    let start = 0;
    while (true) {
        const idx = content.indexOf(find, start);
        if (idx === -1) break;
        yield find;
        start = idx + find.length;
    }
};

const REPLACERS: Replacer[] = [
    SimpleReplacer,
    LineTrimmedReplacer,
    BlockAnchorReplacer,
    WhitespaceNormalizedReplacer,
    IndentationFlexibleReplacer,
    EscapeNormalizedReplacer,
    TrimmedBoundaryReplacer,
    ContextAwareReplacer,
    MultiOccurrenceReplacer,
];

function replaceContent(content: string, oldText: string, newText: string, replaceAll = false): string {
    if (oldText === newText) throw new Error('oldText 与 newText 相同，无需修改');
    let notFound = true;
    for (const replacer of REPLACERS) {
        for (const search of replacer(content, oldText)) {
            const idx = content.indexOf(search);
            if (idx === -1) continue;
            notFound = false;
            if (replaceAll) return content.replaceAll(search, newText);
            const lastIdx = content.lastIndexOf(search);
            if (idx !== lastIdx) continue; // 多处匹配 → 尝试下一个 replacer
            return content.substring(0, idx) + newText + content.substring(idx + search.length);
        }
    }
    if (notFound) throw new Error(`找不到匹配的文本:\n${oldText}`);
    throw new Error('找到多处相同文本，请提供更多上下文使匹配唯一，或使用 replaceAll: true');
}

// ─── Diff 辅助 ────────────────────────────────────────────────────────────────

function detectLineEnding(text: string): '\n' | '\r\n' {
    return text.includes('\r\n') ? '\r\n' : '\n';
}

function trimDiff(diff: string): string {
    const lines = diff.split('\n');
    const contentLines = lines.filter(l =>
        (l.startsWith('+') || l.startsWith('-') || l.startsWith(' '))
        && !l.startsWith('---') && !l.startsWith('+++'),
    );
    if (contentLines.length === 0) return diff;
    let min = Infinity;
    for (const l of contentLines) {
        const c = l.slice(1);
        if (c.trim().length > 0) {
            const m = c.match(/^(\s*)/);
            if (m) min = Math.min(min, m[1].length);
        }
    }
    if (min === Infinity || min === 0) return diff;
    return lines.map(l => {
        if ((l.startsWith('+') || l.startsWith('-') || l.startsWith(' ')) && !l.startsWith('---') && !l.startsWith('+++'))
            return l[0] + l.slice(1 + min);
        return l;
    }).join('\n');
}

// ─── 核心逻辑 ─────────────────────────────────────────────────────────────────

async function applyFileEdits(filePath: string, edits: FileEdit[], dryRun = false): Promise<string> {
    const raw = await fsAsync.readFile(filePath, 'utf-8');
    const ending = detectLineEnding(raw);
    const original = normalizeLineEndings(raw);
    let modified = original;
    for (const edit of edits) {
        const newN = normalizeLineEndings(edit.newText);
        if (edit.useRegex) {
            const regex = new RegExp(edit.oldText, edit.regexFlags ?? 'g');
            if (!modified.match(regex)) throw new Error(`正则表达式无匹配: ${edit.oldText}`);
            modified = modified.replace(regex, newN);
        } else {
            modified = replaceContent(modified, normalizeLineEndings(edit.oldText), newN, edit.replaceAll ?? false);
        }
    }
    const diff = trimDiff(createTwoFilesPatch(filePath, filePath, original, modified, 'original', 'modified'));
    let ticks = 3;
    while (diff.includes('`'.repeat(ticks))) ticks++;
    const formatted = `${'`'.repeat(ticks)}diff\n${diff}${'`'.repeat(ticks)}\n\n`;
    if (!dryRun) {
        const output = ending === '\r\n' ? modified.replaceAll('\n', '\r\n') : modified;
        await writeAtomic(filePath, output, 'utf-8');
    }
    return formatted;
}

// ─── Tool 定义 ────────────────────────────────────────────────────────────────

/** 精确文本编辑（9 级渐进匹配 + 批量替换 + 正则 + 行尾保留 + unified diff 输出）*/
export function createEditFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'edit_file',
        description: `Performs precise text replacement edits on a file. Supports multiple replacements, regex substitution (useRegex), 9-level fuzzy matching (whitespace/indentation/escape/context-aware), replaceAll, and dry-run preview. Returns a unified diff of all changes. Path must be absolute.
Always prefer this over write_file when modifying existing files.`,
        schema: z.object({
            filePath: z.string().describe('要编辑的文件的绝对路径'),
            edits: z.array(z.object({
                oldText: z.string().describe('要替换的原始文本；useRegex=true 时为正则表达式模式'),
                newText: z.string().describe('替换后的新文本'),
                useRegex: z.boolean().optional().default(false).describe('将 oldText 作为正则表达式，默认 false'),
                regexFlags: z.string().optional().default('g').describe('正则标志，默认 g，仅 useRegex=true 时生效'),
                replaceAll: z.boolean().optional().default(false).describe('替换文件内所有匹配项，默认 false（默认只替换唯一匹配，多处相同时报错）'),
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
