import express from 'express';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { FsApi } from '../FsApi';
import { gitHelper } from '../helpers/git';
import { api, throwBad, parseRangeQuery, resolveExistingDir, safeRelPath, isPathInside, MAX_FILE_READ_SIZE } from '../utils';
import type { RouteContext } from './types';

export class FilesystemRoutes {
    private readonly fsApi = new FsApi();

    register(app: express.Application, _ctx: RouteContext): void {
        const fsApi = this.fsApi;
        const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

        app.get('/api/fs/list', api(req => fsApi.listDir(req.query.path as string | undefined)));

        app.get('/api/fs/quickdirs', api(() => fsApi.quickDirs()));

        app.get('/api/fs/drives', api(() => fsApi.listDrives()));

        app.post('/api/fs/mkdir', api(req => fsApi.mkdir((req.body || {}).path)));

        app.delete('/api/fs/entry', api(req => fsApi.deleteEntry(req.query.path as string | undefined)));

        app.post('/api/fs/upload', upload.single('file'), api(req => {
            const dir = (req.body?.dir ?? req.query.dir) as string | undefined;
            const file = (req as unknown as { file?: { originalname: string; buffer: Buffer } }).file;
            if (!file) throwBad('file is required');
            return fsApi.uploadFile(dir, file.originalname, file.buffer);
        }));

        app.post('/api/fs/entry', api(req => {
            const { path: filePath, content } = req.body || {};
            return fsApi.createFile(filePath, content ?? '');
        }));

        app.put('/api/fs/entry', express.json({ limit: '2mb' }), api(req => {
            const { path: filePath, content, expectedMtime } = req.body || {};
            return fsApi.writeFile(filePath, content ?? '', { expectedMtime });
        }));

        app.get('/api/fs/entry', api(req => {
            const filePath = req.query.path as string | undefined;
            const entryType = (req.query.type as string | undefined) || '';
            const recursive = req.query.recursive === '1' || req.query.recursive === 'true';
            if (entryType === 'tree') return fsApi.listTree(filePath, recursive);
            if (entryType === 'read') {
                return fsApi.readFile(filePath, {
                    ...parseRangeQuery(req),
                    chunk: req.query.offset != null || req.query.limit != null,
                });
            }
            throwBad('type must be "tree" or "read"');
        }));

        // 资源管理器：直接下载文件原始内容
        app.get('/api/fs/entry/raw', (req, res) => {
            try {
                const filePath = req.query.path as string | undefined;
                const { path: target } = fsApi.resolve(filePath);
                if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
                    res.status(404).json({ ok: false, message: `File not found: ${target}` });
                    return;
                }
                const fileName = path.basename(target);
                const encoded = encodeURIComponent(fileName);
                res.setHeader(
                    'Content-Disposition',
                    `inline; filename="${fileName.replace(/"/g, '\\"')}"; filename*=UTF-8''${encoded}`,
                );
                res.sendFile(path.resolve(target), { dotfiles: 'allow' });
            } catch (e: any) {
                res.status(e?.status ?? 404).json({ ok: false, message: e?.message ?? 'not found' });
            }
        });

        app.get('/api/git/status', api(async req => {
            const root = (req.query.root as string) ?? '';
            if (!root.trim()) throwBad('root is required');
            const { target } = resolveExistingDir(root.trim());
            const gitRoot = await gitHelper.resolveGitRoot(target);
            if (!gitRoot) return { root: target, items: [] };

            const stdout = await gitHelper.runGit(gitRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
            let branch = (await gitHelper.runGit(gitRoot, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => '')).trim();
            if (branch === 'HEAD') {
                const short = (await gitHelper.runGit(gitRoot, ['rev-parse', '--short', 'HEAD']).catch(() => '')).trim();
                branch = short ? `detached:${short}` : branch;
            }
            return { root: gitRoot, branch, items: gitHelper.parseStatus(stdout) };
        }));

        app.get('/api/git/diff', api(async req => {
            const root = (req.query.root as string) ?? '';
            const rel = (req.query.path as string) ?? '';
            const full = req.query.full === '1' || req.query.full === 'true';
            if (!root.trim()) throwBad('root is required');
            const { target } = resolveExistingDir(root.trim());
            const gitRoot = await gitHelper.resolveGitRoot(target);
            if (!gitRoot) return { root: target, path: rel, diff: '' };

            const relPath = safeRelPath(rel);
            const absPath = path.resolve(gitRoot, relPath);
            if (!isPathInside(gitRoot, absPath)) throwBad('Invalid path');

            const diffArgs = ['diff', '--no-ext-diff', '--text', '--find-renames'];
            if (full) diffArgs.push('--unified=999999');
            diffArgs.push('HEAD', '--', relPath);
            let diff = await gitHelper.runGit(gitRoot, diffArgs);
            if (!diff.trim()) {
                const isTracked = await gitHelper.runGit(gitRoot, ['ls-files', '--error-unmatch', '--', relPath])
                    .then(() => true)
                    .catch(() => false);

                if (!isTracked && fs.existsSync(absPath)) {
                    const stat = fs.statSync(absPath);
                    if (stat.isFile() && stat.size <= MAX_FILE_READ_SIZE) {
                        const buf = fs.readFileSync(absPath);
                        diff = `Untracked file: ${relPath}\n\n${buf.includes(0) ? '[binary file]' : buf.toString('utf-8')}`;
                    } else if (stat.isFile()) {
                        diff = `Untracked file: ${relPath}\n\n[file too large: ${stat.size} bytes]`;
                    }
                }
            }

            return { root: gitRoot, path: relPath, diff };
        }));
    }
}

export const filesystemRoutes = new FilesystemRoutes();
