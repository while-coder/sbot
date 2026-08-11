import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

export class GitHelper {
    async runGit(cwd: string, args: string[]): Promise<string> {
        const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
            encoding: 'utf8',
            windowsHide: true,
            timeout: 10000,
            maxBuffer: 30 * 1024 * 1024,
        });
        return String(stdout);
    }

    async resolveGitRoot(dir: string): Promise<string | null> {
        try {
            const root = (await this.runGit(dir, ['rev-parse', '--show-toplevel'])).trim();
            return root ? path.resolve(root) : null;
        } catch {
            return null;
        }
    }

    parseStatus(output: string) {
        const records = output.split('\0').filter(Boolean);
        const items: {
            path: string;
            oldPath?: string;
            status: string;
            staged: boolean;
            unstaged: boolean;
            untracked: boolean;
        }[] = [];

        for (let i = 0; i < records.length; i++) {
            const rec = records[i];
            if (rec.length < 4) continue;

            const x = rec[0] ?? ' ';
            const y = rec[1] ?? ' ';
            const status = `${x}${y}`;
            const itemPath = rec.slice(3);
            let oldPath: string | undefined;

            if ((x === 'R' || x === 'C' || y === 'R' || y === 'C') && i + 1 < records.length) {
                oldPath = records[++i];
            }

            items.push({
                path: itemPath,
                oldPath,
                status,
                staged: x !== ' ' && x !== '?' && x !== '!',
                unstaged: y !== ' ' && y !== '!',
                untracked: status === '??',
            });
        }

        return items;
    }
}

export const gitHelper = new GitHelper();
