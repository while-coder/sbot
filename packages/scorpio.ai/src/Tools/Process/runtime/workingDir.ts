import fs from 'fs';
import path from 'path';

const PROBE_TIMEOUT_MS = 2_000;

export function validatePath(filePath: string): { valid: boolean; error?: string; absolutePath?: string } {
    if (!filePath || typeof filePath !== 'string') {
        return { valid: false, error: 'Path is empty' };
    }
    if (!path.isAbsolute(filePath)) {
        return { valid: false, error: `Path must be absolute: ${filePath}` };
    }
    return { valid: true, absolutePath: path.normalize(filePath) };
}

/**
 * 给 Promise 套超时。一旦 race 输给 timeout，原 promise 之后仍可能 reject ——
 * 通过提前挂一个 noop catch 把它标记为已处理，避免 unhandledRejection。
 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    p.catch(() => { /* 防止 race 失败方触发 unhandledRejection */ });
    return Promise.race([
        p,
        new Promise<T>((_, reject) => {
            timer = setTimeout(() => reject(Object.assign(new Error(`${label} timed out (${ms} ms)`), { code: 'ETIMEDOUT' })), ms);
        }),
    ]).finally(() => { if (timer) clearTimeout(timer); });
}

export async function resolveWorkingDir(workingDir: string | undefined): Promise<{ cwd?: string; error?: string }> {
    if (!workingDir) return { error: 'workingDir is required' };

    const v = validatePath(workingDir);
    if (!v.valid) return { error: v.error };

    const cwd = v.absolutePath!;
    try {
        const stat = await withTimeout(fs.promises.stat(cwd), PROBE_TIMEOUT_MS, `stat ${cwd}`);
        if (!stat.isDirectory()) return { error: `Path is not a directory: ${cwd}` };
        return { cwd };
    } catch (e: any) {
        if (e?.code === 'ENOENT')    return { error: `Working directory not found: ${cwd}` };
        if (e?.code === 'ETIMEDOUT') return { error: e.message };
        return { error: `Failed to check working directory: ${e?.message ?? e}` };
    }
}
