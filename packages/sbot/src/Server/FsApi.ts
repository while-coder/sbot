import fs from 'fs';
import path from 'path';
import os from 'os';

type FsTreeNode = { name: string; type: 'file' | 'dir'; path: string; size?: number; children?: FsTreeNode[] };
type ReadFileOptions = { offset?: number; limit?: number; chunk?: boolean };

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

function dirFirstByName(a: { isDirectory(): boolean; name: string }, b: { isDirectory(): boolean; name: string }) {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
}

function requireAbsPath(p: string | undefined | null): string {
    if (!p?.trim()) throwBad('path is required');
    const abs = path.resolve(p.trim());
    return abs;
}

export class FsApi {
    listDir(absPath: string | undefined) {
        const target = requireAbsPath(absPath);
        if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
            throwNotFound(`Directory not found: ${target}`);
        }
        const up = path.dirname(target);
        const parent: string | null = up === target ? null : up;

        let entries: fs.Dirent[] = [];
        try { entries = fs.readdirSync(target, { withFileTypes: true }); } catch { /* permission errors */ }

        const items = entries
            .filter(e => e.isDirectory())
            .map(e => path.join(target, e.name))
            .sort((a, b) => a.localeCompare(b));

        return { path: target, parent, items };
    }

    listTree(absPath: string | undefined, recursive = false) {
        const target = requireAbsPath(absPath);
        if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
            throwNotFound(`Directory not found: ${target}`);
        }
        return { path: target, items: this.listTreeFromDir(target, recursive) };
    }

    readFile(absPath: string | undefined, opts: ReadFileOptions = {}) {
        const target = requireAbsPath(absPath);
        if (opts.chunk || opts.offset != null || opts.limit != null) {
            return this.readFileChunk(target, opts);
        }
        return this.readFilePreview(target);
    }

    createFile(absPath: string | undefined, content = '') {
        const target = requireAbsPath(absPath);
        if (fs.existsSync(target)) throwBad(`Already exists: ${target}`);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content, 'utf-8');
        return { path: target, size: fs.statSync(target).size };
    }

    mkdir(absPath: string | undefined) {
        const target = requireAbsPath(absPath);
        if (fs.existsSync(target)) throwBad(`Already exists: ${target}`);
        fs.mkdirSync(target, { recursive: true });
        return { path: target };
    }

    deleteEntry(absPath: string | undefined) {
        const target = requireAbsPath(absPath);
        const parsed = path.parse(target);
        if (parsed.root === target) throwBad(`Refusing to delete filesystem root: ${target}`);
        if (!fs.existsSync(target)) throwNotFound(`Path not found: ${target}`);
        fs.rmSync(target, { recursive: true, force: true });
        return { path: target };
    }

    uploadFile(parentDir: string | undefined, filename: string | undefined, content: Buffer) {
        const parent = requireAbsPath(parentDir);
        if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
            throwNotFound(`Directory not found: ${parent}`);
        }
        const name = (filename ?? '').trim();
        if (!name) throwBad('filename is required');
        if (name !== path.basename(name) || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
            throwBad(`Invalid filename: ${filename}`);
        }
        const target = path.join(parent, name);
        if (fs.existsSync(target)) throwBad(`Already exists: ${target}`);
        fs.writeFileSync(target, content);
        return { path: target, size: content.length };
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

    private listTreeFromDir(dir: string, recursive = false): FsTreeNode[] {
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
        let entries: fs.Dirent[] = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }).sort(dirFirstByName); } catch { return []; }

        const result: FsTreeNode[] = [];
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const node: FsTreeNode = { name: entry.name, type: 'dir', path: full };
                if (recursive) node.children = this.listTreeFromDir(full, true);
                result.push(node);
            } else if (entry.isFile()) {
                let size = 0;
                try { size = fs.statSync(full).size; } catch { /* ignore */ }
                result.push({ name: entry.name, type: 'file', path: full, size });
            }
        }
        return result;
    }

    private readFileChunk(absPath: string, opts: ReadFileOptions = {}) {
        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) throwNotFound(`File not found: ${absPath}`);
        const size = fs.statSync(absPath).size;
        const offset = Math.max(0, Math.min(opts.offset ?? 0, size));
        const limit = opts.limit && opts.limit > 0 ? Math.min(opts.limit, FILE_VIEW_MAX_CHUNK) : FILE_VIEW_DEFAULT_CHUNK;
        const readLen = Math.min(limit, size - offset);

        const buf = Buffer.alloc(readLen);
        if (readLen > 0) {
            const fd = fs.openSync(absPath, 'r');
            try { fs.readSync(fd, buf, 0, readLen, offset); }
            finally { fs.closeSync(fd); }
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

    private readFilePreview(absPath: string) {
        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) throwNotFound(`File not found: ${absPath}`);
        const stat = fs.statSync(absPath);
        const mtime = stat.mtimeMs;
        const imageMimeType = IMAGE_MIME_BY_EXT[path.extname(absPath).toLowerCase()];

        if (imageMimeType) {
            if (stat.size > MAX_IMAGE_READ_SIZE) {
                return { path: absPath, size: stat.size, mtime, tooLarge: true, contentType: 'image', mimeType: imageMimeType, content: '' };
            }
            const buf = fs.readFileSync(absPath);
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
        const buf = fs.readFileSync(absPath);
        if (buf.includes(0)) {
            return { path: absPath, size: stat.size, mtime, tooLarge: false, contentType: 'binary', mimeType: 'application/octet-stream', content: '' };
        }
        return { path: absPath, size: stat.size, mtime, tooLarge: false, contentType: 'text', mimeType: 'text/plain', content: buf.toString('utf-8') };
    }

    writeFile(absPath: string | undefined, content: string, opts: { expectedMtime?: number } = {}) {
        const target = requireAbsPath(absPath);
        if (!fs.existsSync(target)) throwNotFound(`File not found: ${target}`);
        const stat = fs.statSync(target);
        if (!stat.isFile()) throwBad(`Not a file: ${target}`);

        if (opts.expectedMtime != null && Math.abs(stat.mtimeMs - opts.expectedMtime) > 1) {
            const e: any = new Error(`STALE_MTIME: file changed externally (expected ${opts.expectedMtime}, actual ${stat.mtimeMs})`);
            e.status = 409;
            throw e;
        }

        const original = fs.readFileSync(target);
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
            fs.writeFileSync(tmp, normalized, 'utf-8');
            fs.renameSync(tmp, target);
        } catch (e) {
            try { fs.unlinkSync(tmp); } catch { /* ignore */ }
            throw e;
        }

        const newStat = fs.statSync(target);
        return { path: target, size: newStat.size, mtime: newStat.mtimeMs };
    }
}
