import fs from 'fs';
import fsAsync from 'fs/promises';
import path from 'path';
import { randomBytes } from 'crypto';
import { createTwoFilesPatch } from 'diff';

export function formatSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 B';
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return i === 0 ? `${bytes} B` : `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

export function normalizeLineEndings(text: string): string {
    return text.replace(/\r\n/g, '\n');
}

/** 将通配符模式转为正则 */
export function globToRegex(pattern: string): RegExp {
    return new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$', 'i');
}

/** 路径验证：非绝对路径时抛出异常 */
export function resolvePath(p: string): string {
    if (!path.isAbsolute(p)) throw new Error(`路径必须是绝对路径: ${p}`);
    return path.normalize(p);
}

/** 验证并返回已存在文件的绝对路径和 stat，不满足时抛出 */
export function checkFile(filePath: string): { abs: string; stat: fs.Stats } {
    const abs = resolvePath(filePath);
    if (!fs.existsSync(abs)) throw new Error(`文件不存在: ${abs}`);
    const stat = fs.statSync(abs);
    if (!stat.isFile()) throw new Error(`路径不是文件: ${abs}`);
    return { abs, stat };
}

/** 验证并返回已存在目录的绝对路径，不满足时抛出 */
export function checkDir(dirPath: string): string {
    const abs = resolvePath(dirPath);
    if (!fs.existsSync(abs)) throw new Error(`目录不存在: ${abs}`);
    if (!fs.statSync(abs).isDirectory()) throw new Error(`路径不是目录: ${abs}`);
    return abs;
}

/** 原子写入：先写临时文件再 rename，失败时清理临时文件 */
export async function writeAtomic(filePath: string, content: string, encoding: BufferEncoding): Promise<void> {
    const tmp = `${filePath}.${randomBytes(16).toString('hex')}.tmp`;
    try {
        await fsAsync.writeFile(tmp, content, encoding);
        await fsAsync.rename(tmp, filePath);
    } catch (e) {
        try { await fsAsync.unlink(tmp); } catch { /* ignore */ }
        throw e;
    }
}

/** 内存高效的 tail：从文件末尾读取 N 行（1KB 分块）*/
export async function tailFile(filePath: string, numLines: number): Promise<string> {
    const CHUNK = 1024;
    const stats = await fsAsync.stat(filePath);
    if (stats.size === 0) return '';
    const fh = await fsAsync.open(filePath, 'r');
    try {
        const lines: string[] = [];
        let position = stats.size;
        const buf = Buffer.alloc(CHUNK);
        let linesFound = 0;
        let remaining = '';
        while (position > 0 && linesFound < numLines) {
            const size = Math.min(CHUNK, position);
            position -= size;
            const { bytesRead } = await fh.read(buf, 0, size, position);
            if (!bytesRead) break;
            const chunk = normalizeLineEndings(buf.slice(0, bytesRead).toString('utf-8')) + remaining;
            const parts = chunk.split('\n');
            if (position > 0) remaining = parts.shift()!;
            for (let i = parts.length - 1; i >= 0 && linesFound < numLines; i--) {
                lines.unshift(parts[i]);
                linesFound++;
            }
        }
        return lines.join('\n');
    } finally {
        await fh.close();
    }
}

/** 内存高效的 head：从文件头读取 N 行 */
export async function headFile(filePath: string, numLines: number): Promise<string> {
    const fh = await fsAsync.open(filePath, 'r');
    try {
        const lines: string[] = [];
        let buffer = '';
        let offset = 0;
        const chunk = Buffer.alloc(1024);
        while (lines.length < numLines) {
            const { bytesRead } = await fh.read(chunk, 0, chunk.length, offset);
            if (bytesRead === 0) break;
            offset += bytesRead;
            buffer += normalizeLineEndings(chunk.subarray(0, bytesRead).toString('utf-8'));
            const nl = buffer.lastIndexOf('\n');
            if (nl !== -1) {
                const complete = buffer.slice(0, nl).split('\n');
                buffer = buffer.slice(nl + 1);
                for (const line of complete) {
                    lines.push(line);
                    if (lines.length >= numLines) break;
                }
            }
        }
        if (buffer.length > 0 && lines.length < numLines) lines.push(buffer);
        return lines.join('\n');
    } finally {
        await fh.close();
    }
}

export interface FileEdit { oldText: string; newText: string; useRegex?: boolean; regexFlags?: string; }

/** 按 oldText→newText 对文件做多处修改，支持模糊空白匹配和正则替换，返回 unified diff */
export async function applyFileEdits(filePath: string, edits: FileEdit[], dryRun = false): Promise<string> {
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
