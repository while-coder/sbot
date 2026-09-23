import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import type { MemoryWorkspaceScope } from "../Storage/IMemoryStore";

/**
 * workPath → 工作区身份的解析逻辑（纯 FS 同步探测，不依赖 git CLI——resolveWorkspace
 * 在 pool.acquire 的同步路径上，绝不能 throw）。
 *
 * **身份不变量**：identity 永远是一个 canonical 绝对路径字符串，仓库探测只是把
 * 仓库内的子路径折叠到仓库根（worktree 折叠到 common dir 对应的主仓库根）。
 * 同一路径无论是否 repo，identity 恒定——因此「workPath 恰为仓库根」的存量 key
 * 在引入仓库语义前后不变，repo ↔ 非 repo 转换（git init / 删 .git）也不丢记忆。
 */

/** 一个目录所在 git 仓库的探测结果；非 repo 或探测失败时 repoRoot/gitDir 均为 null。 */
export interface GitWorkspaceProbe {
    /** 仓库根（canonical 绝对路径，未做大小写归一）。 */
    repoRoot: string | null;
    /** 实际生效的 git dir（主仓库 .git / worktree 的 common dir / submodule gitdir）；诊断用。 */
    gitDir: string | null;
}

const GIT_DIR_FILE_PREFIX = 'gitdir: ';

/**
 * 从 canonicalDir 向上探测所在 git 仓库的根。
 *
 * - `.git` 是目录：内有 HEAD 才视为有效仓库（假目录继续向上）。
 * - `.git` 是文件（worktree / submodule）：解析 `gitdir: ` 指向的 gitDir；
 *   - gitDir 有 `commondir` 文件 → worktree，common dir 所在目录即主仓库根（多 worktree 共享身份）；
 *   - 无 commondir → submodule，`.git` 文件所在目录自身作为仓库根（各 submodule 独立）；
 *   - gitDir / commondir 指向不存在的目录或缺少 HEAD → 探测失败返回 null
 *     （不继续向上——git 遇到损坏 .git 也是 fatal，继续走可能意外挂到外层仓库）。
 * - bare repo（无 .git 条目）不特殊支持，按非 repo 处理。
 * - stat/读取抛错（权限等）：walk 中视为不存在继续向上；解析链路上抛错则返回 null。
 */
export function probeGitWorkspace(canonicalDir: string): GitWorkspaceProbe {
    let dir = path.normalize(canonicalDir).replace(/[\\/]+$/, '') || path.parse(canonicalDir).root;
    while (true) {
        const gitEntry = path.join(dir, '.git');
        const stat = statQuiet(gitEntry);
        if (stat?.isDirectory()) {
            if (existsSync(path.join(gitEntry, 'HEAD'))) {
                return { repoRoot: dir, gitDir: gitEntry };
            }
            // 同名假目录：与 git 一致，继续向上找外层仓库
        } else if (stat?.isFile()) {
            const gitDir = parseGitDirFile(gitEntry, dir);
            if (!gitDir || !gitDirHasHead(gitDir)) return { repoRoot: null, gitDir: null };
            const commonDirFile = path.join(gitDir, 'commondir');
            if (existsSync(commonDirFile)) {
                const commonDir = readCommonDir(commonDirFile, gitDir);
                // commondir 存在但无效：按探测失败处理（不当作 submodule，也不继续向上）
                if (!commonDir) return { repoRoot: null, gitDir: null };
                return { repoRoot: path.dirname(commonDir), gitDir: commonDir };
            }
            // 无 commondir：submodule——.git 文件所在目录自身即仓库根
            return { repoRoot: dir, gitDir };
        }
        const parent = path.dirname(dir);
        if (parent === dir) return { repoRoot: null, gitDir: null };
        dir = parent;
    }
}

/**
 * MemoryService.resolveWorkspace 的全部逻辑：resolved 路径（可能不存在，realpath
 * 失败时回退 path.resolve 结果）→ 规范化 → 仓库根折叠 → 归一化 identity hash。
 */
export function resolveWorkspaceIdentity(resolvedDir: string): MemoryWorkspaceScope {
    let canonical = resolvedDir;
    try { canonical = realpathSync.native(resolvedDir); } catch { /* 目录可能尚未创建，用 resolve 结果 */ }
    canonical = path.normalize(canonical).replace(/[\\/]+$/, '') || path.parse(canonical).root;
    const { repoRoot } = probeGitWorkspace(canonical);
    const displayPath = repoRoot ?? canonical;
    const identity = process.platform === 'win32' ? displayPath.toLocaleLowerCase('en-US') : displayPath;
    return {
        key: createHash('sha256').update(identity).digest('hex').slice(0, 24),
        path: displayPath,
    };
}

/** stat 但不抛错：不存在/权限不足均返回 null。 */
function statQuiet(p: string): ReturnType<typeof statSync> | null {
    try { return statSync(p); } catch { return null; }
}

/** 解析 `.git` 文件内容（`gitdir: <path>`，容忍 CRLF 与空白）；格式非法返回 null。 */
function parseGitDirFile(gitEntry: string, dir: string): string | null {
    try {
        const content = readFileSync(gitEntry, 'utf8').trim();
        if (!content.startsWith(GIT_DIR_FILE_PREFIX)) return null;
        const raw = content.slice(GIT_DIR_FILE_PREFIX.length).trim();
        if (!raw) return null;
        return path.isAbsolute(raw) ? raw : path.resolve(dir, raw);
    } catch { return null; }
}

function gitDirHasHead(gitDir: string): boolean {
    return existsSync(path.join(gitDir, 'HEAD'));
}

/**
 * 读 commondir 文件内容（worktree 的 gitdir 里存指向主仓库 git dir 的相对路径）。
 * 内容为空/指向的目录无效返回 null（按探测失败处理）。
 */
function readCommonDir(commonDirFile: string, gitDir: string): string | null {
    try {
        const raw = readFileSync(commonDirFile, 'utf8').trim();
        if (!raw) return null;
        const commonDir = path.isAbsolute(raw) ? raw : path.resolve(gitDir, raw);
        if (!gitDirHasHead(commonDir)) return null;
        return commonDir;
    } catch { return null; }
}
