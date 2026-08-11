import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { MemoryScope, type MemoryTarget } from "../Storage/IMemoryStore";

const COMMIT_RE = /^[0-9a-f]{7,40}$/i;
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_DIFF_BYTES = 512 * 1024;

const GITIGNORE_WITHOUT_ARCHIVE = [
    "*.db",
    "*.db-*",
    "*.sqlite",
    "*.sqlite-*",
    "",
].join("\n");

const GITIGNORE = [
    "*.db",
    "*.db-*",
    "*.sqlite",
    "*.sqlite-*",
    "**/.archive/",
    "",
].join("\n");

const GITATTRIBUTES = [
    "*.md text eol=lf",
    "*.json text eol=lf",
    "",
].join("\n");

export interface MemoryHistoryEntry {
    hash: string;
    shortHash: string;
    committedAt: number;
    message: string;
}

export interface MemoryHistoryDiff extends MemoryHistoryEntry {
    diff: string;
    /** 该 commit 中是否存在可恢复的单条 Markdown 版本。 */
    restorable: boolean;
}

/**
 * 每个 Memory Profile 一个本地 Git 仓库。
 *
 * Git 只跟踪 Markdown 真源与 scope.json；SQLite、FTS/embedding 缓存和 WAL 都是
 * 可重建运行数据，不进入历史。所有 Git 调用都使用 argv，不经过 shell。
 */
export class MemoryHistory {
    private initializationError: Error | null = null;

    constructor(readonly rootDir: string) {
        mkdirSync(rootDir, { recursive: true });
        try {
            this.initialize();
        } catch (error: any) {
            // 历史不可用不能拖垮 Memory 读写；CRUD 会继续工作，历史 API 返回明确错误。
            this.initializationError = error instanceof Error ? error : new Error(String(error));
        }
    }

    list(target: MemoryTarget, limit = 50, slug?: string): MemoryHistoryEntry[] {
        this.ensureReady();
        const gitPaths = this.historyPaths(target, slug);
        const output = this.git([
            "log",
            `--max-count=${Math.max(1, Math.min(Math.trunc(limit) || 50, 200))}`,
            "--format=%H%x1f%h%x1f%ct%x1f%s%x1e",
            "--",
            ...gitPaths,
        ], true);
        if (!output.trim()) return [];
        return output
            .split("\x1e")
            .map(record => record.trim())
            .filter(Boolean)
            .map(record => {
                const [hash, shortHash, seconds, ...message] = record.split("\x1f");
                return {
                    hash,
                    shortHash,
                    committedAt: Number(seconds) * 1000,
                    message: message.join("\x1f"),
                };
            });
    }

    diff(commit: string, target: MemoryTarget, slug?: string): MemoryHistoryDiff {
        this.ensureReady();
        this.assertCommit(commit);
        const entry = this.commitEntry(commit);
        const output = this.git([
            "show",
            "--root",
            "--no-color",
            "--no-ext-diff",
            "--format=",
            "--unified=3",
            commit,
            "--",
            ...this.historyPaths(target, slug),
        ], true);
        return {
            ...entry,
            diff: this.bound(output),
            restorable: slug ? this.findVersionContent(commit, target, slug) != null : false,
        };
    }

    restore(commit: string, target: MemoryTarget, slug: string): void {
        this.ensureReady();
        this.assertCommit(commit);
        this.assertSlug(slug);
        const gitPath = this.activePath(target, slug);
        const content = this.findVersionContent(commit, target, slug);
        if (content == null) throw new Error(`Memory ${slug} does not exist in commit ${commit.slice(0, 8)}`);
        const absolutePath = path.join(this.rootDir, ...gitPath.split("/"));
        mkdirSync(path.dirname(absolutePath), { recursive: true });
        writeFileSync(absolutePath, content, "utf8");
    }

    /** 将当前 Markdown 工作树追加为一条历史；无文件变化时不产生空提交。 */
    record(message: string): string | null {
        this.ensureReady();
        this.git(["add", "-A", "--", "."]);
        if (!this.git(["status", "--porcelain=v1", "--untracked-files=all"], true).trim()) {
            return null;
        }
        this.git(["commit", "--no-gpg-sign", "-m", message]);
        return this.git(["rev-parse", "HEAD"]).trim();
    }

    private initialize(): void {
        const gitDir = path.join(this.rootDir, ".git");
        const fresh = !existsSync(gitDir);

        // 首次基线先不忽略旧 archive：先把其中内容保存进 Git，再删除工作副本。
        this.writeOwnedFile(".gitignore", fresh ? GITIGNORE_WITHOUT_ARCHIVE : GITIGNORE);
        this.writeOwnedFile(".gitattributes", GITATTRIBUTES);

        if (fresh) {
            this.git(["init", "--initial-branch=main"]);
        }
        this.git(["config", "user.name", "sbot Memory"]);
        this.git(["config", "user.email", "memory@sbot.local"]);
        this.git(["config", "core.autocrlf", "false"]);

        if (fresh) {
            this.git(["add", "-A", "--", "."]);
            this.git(["commit", "--no-gpg-sign", "--allow-empty", "-m", "Initialize memory history"]);
        }

        const removedLegacyArchives = this.removeLegacyArchives();
        this.writeOwnedFile(".gitignore", GITIGNORE);
        if (removedLegacyArchives || this.git(["status", "--porcelain=v1"], true).trim()) {
            this.record(removedLegacyArchives ? "Remove legacy memory archives" : "Update memory history settings");
        }
    }

    private removeLegacyArchives(): boolean {
        const archiveDirs = [path.join(this.rootDir, "memories", ".archive")];
        const workspacesDir = path.join(this.rootDir, "workspaces");
        if (existsSync(workspacesDir)) {
            for (const key of readdirSync(workspacesDir)) {
                archiveDirs.push(path.join(workspacesDir, key, "memories", ".archive"));
            }
        }
        let removed = false;
        for (const archiveDir of archiveDirs) {
            if (!existsSync(archiveDir)) continue;
            rmSync(archiveDir, { recursive: true, force: true });
            removed = true;
        }
        return removed;
    }

    private historyPaths(target: MemoryTarget, slug?: string): string[] {
        if (slug) this.assertSlug(slug);
        const prefix = this.targetPrefix(target);
        return slug
            ? [`${prefix}/${slug}.md`, `:(glob)${prefix}/.archive/${slug}-*.md`]
            : [prefix];
    }

    private activePath(target: MemoryTarget, slug: string): string {
        return `${this.targetPrefix(target)}/${slug}.md`;
    }

    private findVersionContent(commit: string, target: MemoryTarget, slug: string): string | null {
        const activePath = this.activePath(target, slug);
        const active = this.gitOptional(["show", `${commit}:${activePath}`]);
        if (active != null) return active;

        // 旧版 .archive 迁移时已先进入初始 commit；允许从那份历史恢复，
        // 这样删除 archive 目录不会让此前软删除的内容失去 UI 恢复能力。
        const prefix = this.targetPrefix(target);
        const archived = this.git(["ls-tree", "-r", "--name-only", commit, "--", `${prefix}/.archive`])
            .split(/\r?\n/)
            .filter(file => path.posix.basename(file).startsWith(`${slug}-`) && file.endsWith(".md"))
            .sort()
            .at(-1);
        return archived ? this.git(["show", `${commit}:${archived}`]) : null;
    }

    private targetPrefix(target: MemoryTarget): string {
        return target.scope === MemoryScope.Global
            ? "memories"
            : `workspaces/${target.workspace.key}/memories`;
    }

    private commitEntry(commit: string): MemoryHistoryEntry {
        const output = this.git(["show", "-s", "--format=%H%x1f%h%x1f%ct%x1f%s", commit]).trim();
        const [hash, shortHash, seconds, ...message] = output.split("\x1f");
        return {
            hash,
            shortHash,
            committedAt: Number(seconds) * 1000,
            message: message.join("\x1f"),
        };
    }

    private writeOwnedFile(relativePath: string, content: string): void {
        const absolutePath = path.join(this.rootDir, relativePath);
        if (!existsSync(absolutePath) || readFileSync(absolutePath, "utf8") !== content) {
            writeFileSync(absolutePath, content, "utf8");
        }
    }

    private git(args: string[], allowEmpty = false): string {
        const result = spawnSync("git", args, {
            cwd: this.rootDir,
            encoding: "utf8",
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
        });
        if (result.error) {
            throw new Error(`Memory Git unavailable: ${result.error.message}`);
        }
        if (result.status !== 0) {
            const detail = String(result.stderr || result.stdout || "unknown git error").trim();
            if (allowEmpty && !detail) return "";
            throw new Error(`Memory Git failed (${args[0]}): ${detail}`);
        }
        return String(result.stdout ?? "");
    }

    private gitOptional(args: string[]): string | null {
        const result = spawnSync("git", args, {
            cwd: this.rootDir,
            encoding: "utf8",
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
        });
        if (result.error) throw new Error(`Memory Git unavailable: ${result.error.message}`);
        return result.status === 0 ? String(result.stdout ?? "") : null;
    }

    private assertCommit(commit: string): void {
        if (!COMMIT_RE.test(commit)) throw new Error("Invalid memory history commit");
    }

    private ensureReady(): void {
        if (this.initializationError) {
            throw new Error(`Memory history is unavailable: ${this.initializationError.message}`);
        }
    }

    private assertSlug(slug: string): void {
        if (!SLUG_RE.test(slug)) throw new Error(`Invalid memory slug: ${slug}`);
    }

    private bound(value: string): string {
        if (Buffer.byteLength(value, "utf8") <= MAX_DIFF_BYTES) return value;
        const buffer = Buffer.from(value, "utf8").subarray(0, MAX_DIFF_BYTES);
        return `${buffer.toString("utf8")}\n\n[diff truncated at ${MAX_DIFF_BYTES} bytes]\n`;
    }
}
