/**
 * GitWorkspaceIdentity 回归测试：workPath → 工作区身份（git 仓库根折叠）。
 *
 * fixture 全部手工摆文件（.git/HEAD、.git 文件、worktree commondir 等），
 * 不依赖 git CLI——node:test 环境里 spawn git 慢且依赖环境。
 *
 * 运行：pnpm -F agent.memory test
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { probeGitWorkspace, resolveWorkspaceIdentity } from '../src/Service/GitWorkspaceIdentity';

// 先 realpath tmpdir：Windows/macOS 的 temp 可能是符号链接，保证 fixture 路径与 realpath 一致
const tmpRoot = realpathSync.native(os.tmpdir());

let base: string;

beforeEach(() => {
    base = mkdtempSync(path.join(tmpRoot, 'mem-ws-'));
});

afterEach(() => {
    rmSync(base, { recursive: true, force: true });
});

/** 手工摆一个 .git 目录（带 HEAD，git 视为有效仓库的最小形态）。 */
function makeRepo(dir: string): void {
    mkdirSync(path.join(dir, '.git'), { recursive: true });
    writeFileSync(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
}

/** 手工摆一个 .git 文件（worktree / submodule 形态）。 */
function makeGitFile(dir: string, gitdir: string): void {
    writeFileSync(path.join(dir, '.git'), `gitdir: ${gitdir}\n`);
}

/** 摆一个 worktree 的 gitdir（HEAD + commondir 指向主仓库 .git）。 */
function makeWorktreeGitDir(main: string, name: string, commondirContent: string): void {
    mkdirSync(path.join(main, '.git', 'worktrees', name), { recursive: true });
    writeFileSync(path.join(main, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(path.join(main, '.git', 'worktrees', name, 'HEAD'), 'ref: refs/heads/wt\n');
    writeFileSync(path.join(main, '.git', 'worktrees', name, 'commondir'), commondirContent);
}

const isWin = process.platform === 'win32';

function shaOf(p: string): string {
    return createHash('sha256').update(isWin ? p.toLocaleLowerCase('en-US') : p).digest('hex').slice(0, 24);
}

test('非 repo 目录：probe 返回 null，identity 用路径本身', () => {
    const dir = path.join(base, 'plain');
    mkdirSync(dir);

    const probe = probeGitWorkspace(dir);
    assert.deepEqual(probe, { repoRoot: null, gitDir: null });

    const ws = resolveWorkspaceIdentity(dir);
    assert.equal(ws.key, shaOf(dir), 'key 应等于路径本身的 hash');
    assert.equal(ws.path, dir);
});

test('单 repo：根与子目录同 key，path 折叠到仓库根', () => {
    const repo = path.join(base, 'proj');
    mkdirSync(path.join(repo, 'src'), { recursive: true });
    makeRepo(repo);

    const rootWs = resolveWorkspaceIdentity(repo);
    const subWs = resolveWorkspaceIdentity(path.join(repo, 'src'));

    assert.equal(rootWs.key, subWs.key, '子目录应折叠到仓库根');
    assert.equal(rootWs.path, repo);
    assert.equal(subWs.path, repo, '子目录的 path 也应为仓库根');
    assert.equal(rootWs.key, shaOf(repo), 'identity 即仓库根路径');
});

test('worktree（相对 gitdir）：与主仓库同 key', () => {
    const main = path.join(base, 'main');
    const wt = path.join(base, 'wt');
    makeWorktreeGitDir(main, 'wt', '../..\n');
    mkdirSync(wt);
    // worktree 的 .git 文件在真实 git 里用相对路径（相对于 worktree 目录）
    makeGitFile(wt, path.join('..', 'main', '.git', 'worktrees', 'wt'));

    const mainWs = resolveWorkspaceIdentity(main);
    const wtWs = resolveWorkspaceIdentity(wt);

    assert.equal(wtWs.key, mainWs.key, 'worktree 应共享主仓库身份');
    assert.equal(wtWs.path, main, 'path 显示主仓库根');
    assert.equal(probeGitWorkspace(wt).gitDir, path.join(main, '.git'));
});

test('worktree（绝对 gitdir）：与主仓库同 key', () => {
    const main = path.join(base, 'main2');
    const wt = path.join(base, 'wt2');
    makeWorktreeGitDir(main, 'wt', '../..\n');
    mkdirSync(wt);
    makeGitFile(wt, path.join(main, '.git', 'worktrees', 'wt'));

    const mainWs = resolveWorkspaceIdentity(main);
    const wtWs = resolveWorkspaceIdentity(wt);

    assert.equal(wtWs.key, mainWs.key, '绝对 gitdir 同样共享');
    assert.equal(wtWs.path, main);
});

test('submodule（无 commondir）：以 .git 文件所在目录为根，独立于外层仓库', () => {
    const proj = path.join(base, 'proj');
    mkdirSync(path.join(proj, '.git', 'modules', 'sub'), { recursive: true });
    writeFileSync(path.join(proj, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    writeFileSync(path.join(proj, '.git', 'modules', 'sub', 'HEAD'), 'ref: refs/heads/main\n');
    mkdirSync(path.join(proj, 'sub'));
    makeGitFile(path.join(proj, 'sub'), path.join('..', '.git', 'modules', 'sub'));

    const projWs = resolveWorkspaceIdentity(proj);
    const subWs = resolveWorkspaceIdentity(path.join(proj, 'sub'));

    assert.notEqual(subWs.key, projWs.key, 'submodule 应是独立 workspace');
    assert.equal(subWs.path, path.join(proj, 'sub'));
    assert.equal(probeGitWorkspace(path.join(proj, 'sub')).gitDir, path.join(proj, '.git', 'modules', 'sub'));
});

test('损坏 .git 文件（无 gitdir: 前缀）：探测失败，退回纯路径身份', () => {
    const dir = path.join(base, 'broken');
    mkdirSync(dir);
    writeFileSync(path.join(dir, '.git'), 'hello\n');

    assert.deepEqual(probeGitWorkspace(dir), { repoRoot: null, gitDir: null });
    assert.equal(resolveWorkspaceIdentity(dir).key, shaOf(dir));
});

test('gitdir 指向不存在的目录：探测失败', () => {
    const dir = path.join(base, 'dangling-gitdir');
    mkdirSync(dir);
    makeGitFile(dir, path.join(dir, 'nowhere'));

    assert.deepEqual(probeGitWorkspace(dir), { repoRoot: null, gitDir: null });
    assert.equal(resolveWorkspaceIdentity(dir).key, shaOf(dir));
});

test('commondir 指向不存在的目录：探测失败', () => {
    const main = path.join(base, 'dangling-commondir');
    const wt = path.join(base, 'wt');
    makeWorktreeGitDir(main, 'wt', '../../../nowhere\n');
    mkdirSync(wt);
    makeGitFile(wt, path.join(main, '.git', 'worktrees', 'wt'));

    assert.deepEqual(probeGitWorkspace(wt), { repoRoot: null, gitDir: null });
});

test('commondir 目录无 HEAD：探测失败', () => {
    const main = path.join(base, 'main-nohead');
    const wt = path.join(base, 'wt-nohead');
    mkdirSync(path.join(main, '.git', 'other'), { recursive: true });
    writeFileSync(path.join(main, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    mkdirSync(path.join(main, '.git', 'worktrees', 'wt'), { recursive: true });
    writeFileSync(path.join(main, '.git', 'worktrees', 'wt', 'HEAD'), 'ref: refs/heads/wt\n');
    writeFileSync(path.join(main, '.git', 'worktrees', 'wt', 'commondir'), '../other\n');
    mkdirSync(wt);
    makeGitFile(wt, path.join(main, '.git', 'worktrees', 'wt'));

    assert.deepEqual(probeGitWorkspace(wt), { repoRoot: null, gitDir: null });
});

test('.git 是假目录（无 HEAD）：继续向上命中外层仓库', () => {
    const outer = path.join(base, 'outer');
    const inner = path.join(outer, 'inner');
    mkdirSync(path.join(outer, '.git'), { recursive: true });
    mkdirSync(inner, { recursive: true });
    writeFileSync(path.join(outer, '.git', 'HEAD'), 'ref: refs/heads/main\n');

    assert.equal(probeGitWorkspace(inner).repoRoot, outer, '假 .git 目录应被跳过');
});

test('走到文件系统根：不抛错、返回 null', () => {
    const root = path.parse(tmpRoot).root;
    assert.doesNotThrow(() => probeGitWorkspace(root));
    assert.deepEqual(probeGitWorkspace(root), { repoRoot: null, gitDir: null });
});

test('嵌套 repo：最近 .git 优先', () => {
    const outer = path.join(base, 'outer-repo');
    const inner = path.join(outer, 'inner');
    makeRepo(outer);
    makeRepo(inner);

    assert.equal(probeGitWorkspace(inner).repoRoot, inner);
});
