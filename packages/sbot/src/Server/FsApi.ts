import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';

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

function safeRelPath(relPath: string | undefined): string {
    if (!relPath?.trim()) throwBad('path is required');
    const normalized = path.normalize(relPath.trim()).replace(/\\/g, '/');
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) throwBad('Invalid path');
    return normalized;
}

function safeOptionalRelPath(relPath: string | undefined): string {
    if (!relPath?.trim()) return '';
    const normalized = path.normalize(relPath.trim()).replace(/\\/g, '/');
    if (normalized === '.') return '';
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) throwBad('Invalid path');
    return normalized;
}

function isPathInside(base: string, target: string): boolean {
    const rel = path.relative(base, target);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

class ManagedFileRoot {
    constructor(readonly id: string, readonly rootPath: string) {}

    resolve(relPath?: string): { relPath: string; target: string } {
        const safe = safeOptionalRelPath(relPath);
        const target = path.resolve(this.rootPath, safe);
        if (!isPathInside(this.rootPath, target)) throwBad('Invalid path');

        if (fs.existsSync(target)) {
            const rootReal = fs.realpathSync(this.rootPath);
            const targetReal = fs.realpathSync(target);
            if (!isPathInside(rootReal, targetReal)) throwBad('Invalid path');
        }

        return { relPath: safe, target };
    }

    listDir(relPath?: string) {
        const { relPath: safe, target } = this.resolve(relPath);
        if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) throwBad(`Path does not exist: ${safe || '.'}`);
        const up = path.posix.dirname(safe);
        const parent: string | null = safe ? (up === '.' ? '' : up) : null;

        let entries: fs.Dirent[] = [];
        try { entries = fs.readdirSync(target, { withFileTypes: true }); } catch { /* ignore permission errors */ }

        const items = entries
            .filter(e => e.isDirectory())
            .map(e => safe ? `${safe}/${e.name}` : e.name)
            .sort((a, b) => a.localeCompare(b));

        return { rootId: this.id, path: safe, parent, items };
    }

    listTree(relPath?: string, recursive = false) {
        const { relPath: safe, target } = this.resolve(relPath);
        if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
            throwNotFound(`Directory "${safe || '.'}" not found`);
        }
        return { id: this.id, rootId: this.id, path: safe, items: this.listTreeFromDir(target, safe, recursive) };
    }

    readFile(relPath: string | undefined, opts: ReadFileOptions = {}) {
        const { relPath: safe, target } = this.resolve(relPath);
        if (opts.chunk || opts.offset != null || opts.limit != null) {
            return this.readFileChunk(target, safe, opts);
        }
        return this.readFilePreview(target, safe);
    }

    createFile(relPath: string | undefined, content = '') {
        const filePath = safeRelPath(relPath);
        const { target } = this.resolve(filePath);
        if (fs.existsSync(target)) throwBad(`Already exists: ${filePath}`);
        const parent = path.dirname(target);
        if (!isPathInside(this.rootPath, parent)) throwBad('Invalid path');
        fs.mkdirSync(parent, { recursive: true });
        fs.writeFileSync(target, content, 'utf-8');
        const stat = fs.statSync(target);
        return { rootId: this.id, path: filePath, size: stat.size };
    }

    mkdir(relPath: string | undefined) {
        if (!relPath?.trim()) throwBad('path is required');
        const { relPath: safe, target } = this.resolve(relPath);
        if (fs.existsSync(target)) throwBad(`Already exists: ${safe}`);
        fs.mkdirSync(target, { recursive: true });
        return { rootId: this.id, path: safe };
    }

    private listTreeFromDir(dir: string, basePath = '', recursive = false): FsTreeNode[] {
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
        let entries: fs.Dirent[] = [];
        try { entries = fs.readdirSync(dir, { withFileTypes: true }).sort(dirFirstByName); } catch { return []; }

        const result: FsTreeNode[] = [];
        for (const entry of entries) {
            const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                const node: FsTreeNode = { name: entry.name, type: 'dir', path: relPath };
                if (recursive) node.children = this.listTreeFromDir(full, relPath, true);
                result.push(node);
            } else if (entry.isFile()) {
                let size = 0;
                try { size = fs.statSync(full).size; } catch { /* ignore */ }
                result.push({ name: entry.name, type: 'file', path: relPath, size });
            }
        }
        return result;
    }

    private readFileChunk(absPath: string, displayPath: string, opts: ReadFileOptions = {}) {
        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
            throwNotFound(`File "${displayPath}" not found`);
        }
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
                return { path: displayPath, size, offset: 0, length: 0, binary: true, content: '', hasMore: false };
            }
        }
        return {
            path: displayPath,
            size,
            offset,
            length: readLen,
            binary: false,
            content: buf.toString('utf-8'),
            hasMore: offset + readLen < size,
        };
    }

    private readFilePreview(absPath: string, displayPath: string) {
        if (!fs.existsSync(absPath) || !fs.statSync(absPath).isFile()) {
            throwNotFound(`File "${displayPath}" not found`);
        }
        const stat = fs.statSync(absPath);
        const imageMimeType = IMAGE_MIME_BY_EXT[path.extname(absPath).toLowerCase()];

        if (imageMimeType) {
            if (stat.size > MAX_IMAGE_READ_SIZE) {
                return { path: displayPath, size: stat.size, tooLarge: true, contentType: 'image', mimeType: imageMimeType, content: '' };
            }
            const buf = fs.readFileSync(absPath);
            return {
                path: displayPath,
                size: stat.size,
                tooLarge: false,
                contentType: 'image',
                mimeType: imageMimeType,
                content: '',
                dataUrl: `data:${imageMimeType};base64,${buf.toString('base64')}`,
            };
        }

        if (stat.size > MAX_FILE_READ_SIZE) {
            return { path: displayPath, size: stat.size, tooLarge: true, contentType: 'text', mimeType: 'text/plain', content: '' };
        }
        const buf = fs.readFileSync(absPath);
        if (buf.includes(0)) {
            return { path: displayPath, size: stat.size, tooLarge: false, contentType: 'binary', mimeType: 'application/octet-stream', content: '' };
        }
        return { path: displayPath, size: stat.size, tooLarge: false, contentType: 'text', mimeType: 'text/plain', content: buf.toString('utf-8') };
    }
}

export class FsApi {
    private readonly rootIdToFile = new Map<string, ManagedFileRoot>();
    private readonly rootPathToId = new Map<string, string>();

    getOrCreateRoot(rootPath: string): string {
        const normalized = path.resolve(rootPath);
        let stat: fs.Stats;
        try { stat = fs.statSync(normalized); }
        catch { throwBad(`Path does not exist: ${normalized}`); }
        if (!stat.isDirectory()) throwBad(`Path is not a directory: ${normalized}`);

        const existingId = this.rootPathToId.get(normalized);
        if (existingId && this.rootIdToFile.has(existingId)) return existingId;

        const id = randomUUID();
        this.rootPathToId.set(normalized, id);
        this.rootIdToFile.set(id, new ManagedFileRoot(id, normalized));
        return id;
    }

    tryGetOrCreateRoot(rootPath: string | null | undefined): string | undefined {
        if (!rootPath) return undefined;
        try { return this.getOrCreateRoot(rootPath); }
        catch { return undefined; }
    }

    listDir(rootId: string | undefined, relPath?: string) {
        return this.getRoot(rootId).listDir(relPath);
    }

    listTree(rootId: string | undefined, relPath?: string, recursive = false) {
        return this.getRoot(rootId).listTree(relPath, recursive);
    }

    readFile(rootId: string | undefined, relPath: string | undefined, opts: ReadFileOptions = {}) {
        return this.getRoot(rootId).readFile(relPath, opts);
    }

    createFile(rootId: string | undefined, relPath: string | undefined, content = '') {
        return this.getRoot(rootId).createFile(relPath, content);
    }

    mkdir(rootId: string | undefined, relPath: string | undefined) {
        return this.getRoot(rootId).mkdir(relPath);
    }

    resolve(rootId: string | undefined, relPath?: string): { rootId: string; relPath: string; target: string } {
        const root = this.getRoot(rootId);
        const resolved = root.resolve(relPath);
        return { rootId: root.id, ...resolved };
    }

    quickDirs() {
        const home = os.homedir();
        const candidates = [
            { label: '主目录', path: home },
            { label: '桌面', path: path.join(home, 'Desktop') },
            { label: '文档', path: path.join(home, 'Documents') },
            { label: '下载', path: path.join(home, 'Downloads') },
        ];
        return candidates
            .filter(d => {
                try { return fs.statSync(d.path).isDirectory(); } catch { return false; }
            })
            .map(d => ({ ...d, rootId: this.getOrCreateRoot(d.path) }));
    }

    private getRoot(rootId: string | undefined): ManagedFileRoot {
        if (!rootId?.trim()) throwBad('rootId is required');
        const root = this.rootIdToFile.get(rootId.trim());
        if (!root) throwNotFound('File root not found');
        return root;
    }
}
