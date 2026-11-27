import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

export async function git(cwd: string, ...args: string[]): Promise<string> {
    const { stdout } = await exec('git', args, { cwd, windowsHide: true, timeout: 120_000 });
    return stdout.trim();
}

export class FeatureLoopWorkspace {
    readonly branch: string;

    constructor(readonly directory: string, loopId: string) {
        this.branch = `sbot-loop/${loopId}`;
    }

    async prepare(repository: string, base: string): Promise<void> {
        await mkdir(path.dirname(this.directory), { recursive: true });
        try {
            await lstat(this.directory);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            const exists = await git(repository, 'branch', '--list', this.branch);
            await git(repository, 'worktree', 'add', ...(exists
                ? [this.directory, this.branch]
                : ['-b', this.branch, this.directory, base]));
        }
        await this.head();
    }

    async head(): Promise<string> {
        const root = await git(this.directory, 'rev-parse', '--show-toplevel');
        if (path.relative(await realpath(this.directory), await realpath(root)) !== ''
            || await git(this.directory, 'symbolic-ref', '--short', 'HEAD') !== this.branch) {
            throw new Error('Feature Loop worktree or branch was changed');
        }
        return git(this.directory, 'rev-parse', 'HEAD');
    }

    async snapshot(base: string): Promise<string> {
        if (await this.head() !== base) throw new Error('Feature Loop branch HEAD was changed');
        await git(this.directory, 'add', '-A', '--', '.', ':(exclude,glob).sbot-features/*.sbot-pending');
        return git(this.directory, 'write-tree');
    }

    async readSpec(relative: string): Promise<{ text: string; hash: string }> {
        const file = path.join(this.directory, relative);
        if (!(await lstat(path.dirname(file))).isDirectory() || !(await lstat(file)).isFile()) {
            throw new Error('Expected a regular product spec in the feature worktree');
        }
        const text = await readFile(file, 'utf8');
        if (!text.trim() || text.length > 100_000) throw new Error('Product spec is empty or too large');
        return { text, hash: createHash('sha256').update(text).digest('hex') };
    }

    async writeSpec(relative: string, text: string): Promise<void> {
        const file = path.join(this.directory, relative);
        const dir = path.dirname(file);
        await mkdir(dir, { recursive: true });
        if (!(await lstat(dir)).isDirectory()) throw new Error('Product spec directory must be a real directory');
        const temporary = path.join(dir, `${randomUUID()}.sbot-pending`);
        await writeFile(temporary, text, { flag: 'wx' });
        try {
            await rename(temporary, file);
        } finally {
            await unlink(temporary).catch(() => undefined);
        }
    }

    async publishedCommit(base: string, featureId: string, tree: string): Promise<string | undefined> {
        const head = await this.head();
        if (head === base) return undefined;
        const parent = await git(this.directory, 'show', '-s', '--format=%P', head);
        const actualTree = await git(this.directory, 'show', '-s', '--format=%T', head);
        const body = await git(this.directory, 'show', '-s', '--format=%B', head);
        if (parent !== base || actualTree !== tree || !body.endsWith(`Sbot-Feature-Id: ${featureId}`)) {
            throw new Error('Feature Loop branch HEAD changed outside the verified commit');
        }
        return head;
    }

    async publish(base: string, featureId: string, tree: string, title: string): Promise<string> {
        const commit = await git(this.directory, 'commit-tree', tree, '-p', base,
            '-m', title, '-m', `Sbot-Feature-Id: ${featureId}`);
        await git(this.directory, 'update-ref', `refs/heads/${this.branch}`, commit, base);
        return commit;
    }
}
