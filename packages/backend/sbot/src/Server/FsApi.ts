import fs from 'fs';
import path from 'path';
import os from 'os';

type FsTreeNode = { name: string; type: 'file' | 'dir'; path: string; size?: number; children?: FsTreeNode[] };
type ReadFileOptions = { offset?: number; limit?: number; chunk?: boolean };
type UploadFileOptions = { overwrite?: boolean };
const fsp = fs.promises;

const MAX_FILE_READ_SIZE = 10 * 1024 * 1024;
const MAX_IMAGE_READ_SIZE = 32 * 1024 * 1024;
const FILE_VIEW_DEFAULT_CHUNK = 1024 * 1024;
const FILE_VIEW_MAX_CHUNK = 8 * 1024 * 1024;

const IMAGE_MIME_BY_EXT: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.avif': 'image/avif',
};

function throwBad(msg: string): never {
    const e: any = new Error(msg);
    e.status = 400;
    throw e;
}

function throwNotFound(msg: string): never {
    const e: any = new Error(msg);
    e.status = 404;
    throw e;
}

function throwConflict(msg: string): never {
    const e: any = new Error(msg);
    e.status = 409;
    throw e;
}

function dirFirstByName(a: { isDirectory(): boolean; name: string }, b: { isDirectory(): boolean; name: string }) {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
}

function requireAbsPath(p: string | undefined | null): string {
    if (!p?.trim()) throwBad('path is required');
    const abs = path.resolve(p.trim());
    return abs;
}

async function statOrNull(p: string): Promise<fs.Stats | null> {
    try {
        return await fsp.stat(p);
    } catch (e: any) {
        if (e?.code === 'ENOENT' || e?.code === 'ENOTDIR' || e?.code === 'EACCES' || e?.code === 'EPERM') return null;
        throw e;
    }
}

export class FsApi {
    async listDir(absPath: string | undefined) {
        const target = requireAbsPath(absPath);
        const stat = await statOrNull(target);
        if (!stat?.isDirectory()) {
            throwNotFound(`Directory not found: ${target}`);
        }
        const up = path.dirname(target);
        const parent: string | null = up === target ? null : up;

        let entries: fs.Dirent[] = [];
        try { entries = await fsp.readdir(target, { withFileTypes: true }); } catch { /* permission errors */ }

        const items = entries
            .filter(e => e.isDirectory())
            .map(e => path.join(target, e.name))
            .sort((a, b) => a.localeCompare(b));

        return { path: target, parent, items };
    }

    async listTree(absPath: string | undefined, recursive = false) {
        const target = requireAbsPath(absPath);
        const stat = await statOrNull(target);
        if (!stat?.isDirectory()) {
            throwNotFound(`Directory not found: ${target}`);
        }
        return { path: target, items: await this.listTreeFromDir(target, recursive) };
    }

    async readFile(absPath: string | undefined, opts: ReadFileOptions = {}) {
        const target = requireAbsPath(absPath);
        if (opts.chunk || opts.offset != null || opts.limit != null) {
            return this.readFileChunk(target, opts);
        }
        return this.readFilePreview(target);
    }

    async createFile(absPath: string | undefined, content = '') {
        const target = requireAbsPath(absPath);
        if (await statOrNull(target)) throwBad(`Already exists: ${target}`);
        await fsp.mkdir(path.dirname(target), { recursive: true });
        await fsp.writeFile(target, content, 'utf-8');
        return { path: target, size: (await fsp.stat(target)).size };
    }

    async mkdir(absPath: string | undefined) {
        const target = requireAbsPath(absPath);
        if (await statOrNull(target)) throwBad(`Already exists: ${target}`);
        await fsp.mkdir(target, { recursive: true });
        return { path: target };
    }

    async deleteEntry(absPath: string | undefined) {
        const target = requireAbsPath(absPath);
        const parsed = path.parse(target);
        if (parsed.root === target) throwBad(`Refusing to delete filesystem root: ${target}`);
        const stat = await statOrNull(target);
        if (!stat) throwNotFound(`Path not found: ${target}`);
        await fsp.rm(target, { recursive: true, force: true });
        return { path: target };
    }

    async uploadFile(parentDir: string | undefined, filename: string | undefined, sourcePath: string, opts: UploadFileOptions = {}) {
        const parent = requireAbsPath(parentDir);
        const parentStat = await statOrNull(parent);
        if (!parentStat?.isDirectory()) {
            throwNotFound(`Directory not found: ${parent}`);
        }
        const name = (filename ?? '').trim();
        if (!name) throwBad('filename is required');
        if (name !== path.basename(name) || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
            throwBad(`Invalid filename: ${filename}`);
        }
        const target = path.join(parent, name);
        const targetStat = await statOrNull(target);
        if (targetStat) {
            if (!targetStat.isFile()) throwBad(`Cannot overwrite non-file entry: ${target}`);
            if (!opts.overwrite) throwConflict(`Already exists: ${target}`);
        }
        try {
            await fsp.rename(sourcePath, target);
        } catch (e: any) {
            if (e?.code === 'EXDEV') {
                await fsp.copyFile(sourcePath, target);
                await fsp.unlink(sourcePath);
            } else {
                throw e;
            }
        }
        return { path: target, size: (await fsp.stat(target)).size };
    }

    resolve(absPath: string | undefined): { path: string } {
        return { path: requireAbsPath(absPath) };
    }

    quickDirs() {
        const home = os.homedir();
        const candidates = [
            { label: '主目录', path: home },
            { label: '桌面', path: path.join(home, 'Desktop') },
            { label: '文档', path: path.join(home, 'Documents') },
            { label: '下载', path: path.join(home, 'Downloads') },
        ];
        const result: { label: string; path: string }[] = [];

        if (process.platform === 'win32') {
            result.push({ label: '我的电脑', path: '' });
        } else {
            try { if (fs.statSync('/').isDirectory()) result.push({ label: '根目录', path: '/' }); } catch { /* ignore */ }
        }

        for (const c of candidates) {
            try { if (fs.statSync(c.path).isDirectory()) result.push({ label: c.label, path: c.path }); } catch { /* ignore */ }
        }
        return result;
    }

    listDrives() {
        const drives: { label: string; path: string }[] = [];
        if (process.platform === 'win32') {
            for (let code = 'C'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code++) {
                const letter = String.fromCharCode(code);
                const p = `${letter}:\\`;
                try { if (!fs.statSync(p).isDirectory()) continue; } catch { continue; }
                drives.push({ label: `${letter}盘`, path: p });
            }
        } else {
            try { if (fs.statSync('/').isDirectory()) drives.push({ label: '根目录', path: '/' }); } catch { /* ignore */ }
        }
        return drives;
    }

    private async listTreeFromDir(dir: string, recursive = false): Promise<FsTreeNode[]> {
        const stat = await statOrNull(dir);
        if (!stat?.isDirectory()) return [];
        let entries: fs.Dirent[] = [];
        try { entries = (await fsp.readdir(dir, { withFileTypes: true })).sort(dirFirstByName); } catch { return []; }

        const result: FsTreeNode[] = [];
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const node: FsTreeNode = { name: entry.name, type: 'dir', path: full };
                if (recursive) node.children = await this.listTreeFromDir(full, true);
                result.push(node);
            } else if (entry.isFile()) {
                let size = 0;
                try { size = (await fsp.stat(full)).size; } catch { /* ignore */ }
                result.push({ name: entry.name, type: 'file', path: full, size });
            }
        }
        return result;
    }

    private async readFileChunk(absPath: string, opts: ReadFileOptions = {}) {
        const stat = await statOrNull(absPath);
        if (!stat?.isFile()) throwNotFound(`File not found: ${absPath}`);
        const size = stat.size;
        const offset = Math.max(0, Math.min(opts.offset ?? 0, size));
        const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, FILE_VIEW_MAX_CHUNK) : FILE_VIEW_DEFAULT_CHUNK;
        const readLen = Math.min(limit, size - offset);

        const buf = Buffer.alloc(readLen);
        if (readLen > 0) {
            const file = await fsp.open(absPath, 'r');
            try { await file.read(buf, 0, readLen, offset); }
            finally { await file.close(); }
        }

        if (offset === 0) {
            const sniff = buf.subarray(0, Math.min(readLen, 8192));
            if (sniff.includes(0)) {
                return { path: absPath, size, offset: 0, length: 0, binary: true, content: '', hasMore: false };
            }
        }
        return {
            path: absPath,
            size,
            offset,
            length: readLen,
            binary: false,
            content: buf.toString('utf-8'),
            hasMore: offset + readLen < size,
        };
    }

    private async readFilePreview(absPath: string) {
        const stat = await statOrNull(absPath);
        if (!stat?.isFile()) throwNotFound(`File not found: ${absPath}`);
        const mtime = stat.mtimeMs;
        const imageMimeType = IMAGE_MIME_BY_EXT[path.extname(absPath).toLowerCase()];

        if (imageMimeType) {
            if (stat.size > MAX_IMAGE_READ_SIZE) {
                return { path: absPath, size: stat.size, mtime, tooLarge: true, contentType: 'image', mimeType: imageMimeType, content: '' };
            }
            const buf = await fsp.readFile(absPath);
            return {
                path: absPath,
                size: stat.size,
                mtime,
                tooLarge: false,
                contentType: 'image',
                mimeType: imageMimeType,
                content: '',
                dataUrl: `data:${imageMimeType};base64,${buf.toString('base64')}`,
            };
        }

        if (stat.size > MAX_FILE_READ_SIZE) {
            return { path: absPath, size: stat.size, mtime, tooLarge: true, contentType: 'text', mimeType: 'text/plain', content: '' };
        }
        const buf = await fsp.readFile(absPath);
        if (buf.includes(0)) {
            return { path: absPath, size: stat.size, mtime, tooLarge: false, contentType: 'binary', mimeType: 'application/octet-stream', content: '' };
        }
        return { path: absPath, size: stat.size, mtime, tooLarge: false, contentType: 'text', mimeType: 'text/plain', content: buf.toString('utf-8') };
    }

    async writeFile(absPath: string | undefined, content: string, opts: { expectedMtime?: number } = {}) {
        const target = requireAbsPath(absPath);
        const stat = await statOrNull(target);
        if (!stat) throwNotFound(`File not found: ${target}`);
        if (!stat.isFile()) throwBad(`Not a file: ${target}`);

        if (opts.expectedMtime != null && Math.abs(stat.mtimeMs - opts.expectedMtime) > 1) {
            const e: any = new Error(`STALE_MTIME: file changed externally (expected ${opts.expectedMtime}, actual ${stat.mtimeMs})`);
            e.status = 409;
            throw e;
        }

        const original = await fsp.readFile(target);
        let normalized = content;
        if (!original.includes(0)) {
            const text = original.toString('utf-8');
            const crlf = (text.match(/\r\n/g) || []).length;
            const lf = (text.match(/\n/g) || []).length - crlf;
            if (crlf > lf) {
                normalized = content.replace(/\r?\n/g, '\r\n');
            }
        }

        const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
        try {
            await fsp.writeFile(tmp, normalized, 'utf-8');
            await fsp.rename(tmp, target);
        } catch (e) {
            try { await fsp.unlink(tmp); } catch { /* ignore */ }
            throw e;
        }

        const newStat = await fsp.stat(target);
        return { path: target, size: newStat.size, mtime: newStat.mtimeMs };
    }
}
