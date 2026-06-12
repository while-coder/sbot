import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import * as fs from "fs/promises";
import path from "path";
import { inject } from "scorpio.di";
import { T_MemoryDir, T_MemoryDbPath } from "../Core/tokens";
import {
    IMemoryStore,
    type MemoryRow,
    type MemoryMenuEntry,
    type MemorySearchHit,
    type CreateMemoryInput,
    type UpdateMemoryInput,
    type ExtractJobRow,
    type ExtractJobStatus,
    type EnqueueExtractInput,
} from "./IMemoryStore";
import { HybridSearcher } from "../Retrieval";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Memory 存储层实现。
 *
 * - FS 是真源：每条 memory 一个文件 `memories/<slug>.md`
 * - DB 是 FTS 索引 + 检索元数据；可重建（reconcile 走盘对账）
 * - delete 是软删除：文件移到 `memories/.archive/<slug>-<deletedAt>.md`，DB 行 DELETE
 *
 * 单连接、同步 better-sqlite3，跨步原子操作走 db.transaction()。
 */
export class MemoryStore implements IMemoryStore {
    public readonly memoriesDir: string;
    public readonly archiveDir: string;
    private _db: Database.Database | undefined;
    private _searcher: HybridSearcher | undefined;

    constructor(
        @inject(T_MemoryDir) public readonly rootDir: string,
        @inject(T_MemoryDbPath) private readonly dbPath: string,
    ) {
        this.memoriesDir = path.join(rootDir, "memories");
        this.archiveDir = path.join(this.memoriesDir, ".archive");
    }

    async init(): Promise<void> {
        if (!existsSync(this.memoriesDir)) mkdirSync(this.memoriesDir, { recursive: true });
        if (!existsSync(this.archiveDir)) mkdirSync(this.archiveDir, { recursive: true });
        // 触发 lazy init（DB schema + HybridSearcher 自管 searcher.sqlite）
        void this.db;
        void this.searcher;
    }

    /**
     * HybridSearcher 自管 SQLite（searcher.sqlite 在 rootDir 下）。
     * 与 memory.db 是两个独立文件：memory.db 装元数据 + 抽取队列；
     * searcher.sqlite 装 FTS5 + embedding 缓存，可以独立重建。
     */
    private get searcher(): HybridSearcher {
        if (!this._searcher) {
            this._searcher = new HybridSearcher({ cachePath: this.rootDir });
        }
        return this._searcher;
    }

    private get db(): Database.Database {
        if (!this._db) {
            const dir = path.dirname(this.dbPath);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            this._db = new Database(this.dbPath);
            this._db.pragma("journal_mode = WAL");
            this._db.exec(`
                CREATE TABLE IF NOT EXISTS memories (
                    id           INTEGER PRIMARY KEY AUTOINCREMENT,
                    slug         TEXT    NOT NULL UNIQUE,
                    title        TEXT    NOT NULL,
                    description  TEXT    NOT NULL,
                    body         TEXT    NOT NULL,
                    fingerprint  TEXT    NOT NULL,
                    created_at   INTEGER NOT NULL,
                    updated_at   INTEGER NOT NULL,
                    last_read_at INTEGER,
                    read_count   INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_memories_lastread ON memories(last_read_at DESC, updated_at DESC);

                -- FTS5 全文索引由 SqliteHybridIndex 持有（前缀 memory_，docs / docs_fts 表）。
                -- 旧版 memories_fts 与触发器已迁移；如有残留通过 DROP IF EXISTS 兼容老库：
                DROP TRIGGER IF EXISTS memories_ai;
                DROP TRIGGER IF EXISTS memories_ad;
                DROP TRIGGER IF EXISTS memories_au;
                DROP TABLE   IF EXISTS memories_fts;

                -- transcript 抽取队列（取代 codex-port 的 phase1_jobs）
                CREATE TABLE IF NOT EXISTS memory_extract_jobs (
                    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                    thread_id           TEXT    NOT NULL,
                    rollout_key         TEXT    NOT NULL UNIQUE,
                    window_start_cursor TEXT    NOT NULL,
                    window_end_cursor   TEXT    NOT NULL,
                    turn_count          INTEGER NOT NULL DEFAULT 0,
                    status              TEXT    NOT NULL,
                    attempt_count       INTEGER NOT NULL DEFAULT 0,
                    next_retry_at       INTEGER,
                    leased_at           INTEGER,
                    lease_expires_at    INTEGER,
                    finished_at         INTEGER,
                    error_message       TEXT,
                    created_at          INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_extract_status ON memory_extract_jobs(status, next_retry_at);
                CREATE INDEX IF NOT EXISTS idx_extract_thread ON memory_extract_jobs(thread_id, created_at DESC);
            `);
        }
        return this._db;
    }

    // ── CRUD ──

    async create(input: CreateMemoryInput, now: number): Promise<MemoryRow> {
        this.assertValidSlug(input.slug);
        const filePath = this.slugToPath(input.slug);
        const content = this.assembleBody(input.title, input.body);

        await fs.writeFile(filePath, content, "utf8");
        const fingerprint = await this.computeFingerprint(filePath);

        try {
            const result = this.db.prepare(`
                INSERT INTO memories (slug, title, description, body, fingerprint, created_at, updated_at)
                VALUES (@slug, @title, @description, @body, @fingerprint, @createdAt, @updatedAt)
            `).run({
                slug: input.slug,
                title: input.title,
                description: input.description,
                body: content,
                fingerprint,
                createdAt: now,
                updatedAt: now,
            });
            const row = this.findByIdSync(Number(result.lastInsertRowid));
            if (!row) throw new Error(`MemoryStore.create: row vanished after insert: ${input.slug}`);
            return row;
        } catch (e: any) {
            // DB 插入失败 → 回滚已写文件，避免 FS / DB 不一致
            await fs.unlink(filePath).catch(() => {});
            if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                throw new Error(`MemoryStore.create: slug already exists: ${input.slug}`);
            }
            throw e;
        }
    }

    async update(input: UpdateMemoryInput, now: number): Promise<MemoryRow> {
        const existing = await this.getBySlug(input.slug);
        if (!existing) throw new Error(`MemoryStore.update: slug not found: ${input.slug}`);

        const newTitle = input.title ?? existing.title;
        const newDescription = input.description ?? existing.description;
        const newBodyRaw = input.body ?? this.stripTitleLine(existing.body);
        const newContent = this.assembleBody(newTitle, newBodyRaw);
        const filePath = this.slugToPath(input.slug);

        await fs.writeFile(filePath, newContent, "utf8");
        const fingerprint = await this.computeFingerprint(filePath);

        this.db.prepare(`
            UPDATE memories
            SET title       = @title,
                description = @description,
                body        = @body,
                fingerprint = @fingerprint,
                updated_at  = @updatedAt
            WHERE slug = @slug
        `).run({
            slug: input.slug,
            title: newTitle,
            description: newDescription,
            body: newContent,
            fingerprint,
            updatedAt: now,
        });
        const row = await this.getBySlug(input.slug);
        if (!row) throw new Error(`MemoryStore.update: row vanished after update: ${input.slug}`);
        return row;
    }

    async softDelete(slug: string, now: number): Promise<string> {
        const existing = await this.getBySlug(slug);
        if (!existing) throw new Error(`MemoryStore.softDelete: slug not found: ${slug}`);

        const filePath = this.slugToPath(slug);
        const archiveName = `${slug}-${now}.md`;
        const archivePath = path.join(this.archiveDir, archiveName);

        // FS 操作先于 DB DELETE：万一 rename 失败，DB 行还在，下次还能看见
        if (existsSync(filePath)) {
            await fs.rename(filePath, archivePath);
        }

        this.db.prepare(`DELETE FROM memories WHERE slug = ?`).run(slug);
        // FTS5 由 HybridSearcher 内部 syncCorpus 在下一次 search 时基于 list() 对账清理
        return archiveName;
    }

    async getBySlug(slug: string): Promise<MemoryRow | null> {
        const row = this.db.prepare(`SELECT * FROM memories WHERE slug = ?`).get(slug);
        return row ? this.mapRow(row) : null;
    }

    async list(): Promise<MemoryRow[]> {
        const rows = this.db.prepare(`SELECT * FROM memories ORDER BY updated_at DESC`).all() as any[];
        return rows.map(r => this.mapRow(r));
    }

    async listMenu(limit: number): Promise<MemoryMenuEntry[]> {
        // 注入 system prompt 用：常被读 + 最近更新优先
        const rows = this.db.prepare(`
            SELECT slug, title, description
            FROM memories
            ORDER BY COALESCE(last_read_at, 0) DESC, updated_at DESC
            LIMIT @limit
        `).all({ limit }) as Array<{ slug: string; title: string; description: string }>;
        return rows;
    }

    // ── 检索 ──

    async search(query: string, limit: number, floorRatio: number): Promise<MemorySearchHit[]> {
        // 把当前所有 memories 喂进 HybridSearcher（内部 syncCorpus 自动对账 docs / docs_fts）。
        // floorRatio 在归一化分数 [0,1] 上做：保留 #1，其余按 top * floorRatio 截断。
        const all = await this.list();
        if (all.length === 0) return [];

        const fetchLimit = Math.min(limit * 3, 50);
        const hits = await this.searcher.search(
            query,
            all,
            (row) => `${row.title}\n${row.body}`,
            fetchLimit,
        );
        if (hits.length === 0) return [];

        const top = hits[0].score;
        const cutoff = floorRatio > 0 ? top * floorRatio : -Infinity;
        return hits
            .filter((r, i) => i === 0 || r.score >= cutoff)
            .slice(0, limit)
            .map(h => ({
                slug: h.item.slug,
                title: h.item.title,
                snippet: h.snippet ?? '',
                score: h.score,
            }));
    }

    async recordRead(slug: string, now: number): Promise<void> {
        this.db.prepare(`
            UPDATE memories
            SET last_read_at = @now,
                read_count   = read_count + 1
            WHERE slug = @slug
        `).run({ slug, now });
    }

    // ── reconcile ──

    async reconcile(): Promise<{ indexed: number; pruned: number }> {
        // 走 memories/ 顶层的 *.md（不递归，不含 .archive/）
        const fsFiles = new Set<string>();
        const entries = await fs.readdir(this.memoriesDir, { withFileTypes: true }).catch(e => {
            if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [] as import('fs').Dirent[];
            throw e;
        });
        for (const ent of entries) {
            if (ent.isFile() && ent.name.endsWith('.md')) {
                fsFiles.add(path.join(this.memoriesDir, ent.name));
            }
        }

        // 当前 DB 已索引的文件（用 slug 推绝对路径）
        const indexed = this.db.prepare(`SELECT slug, fingerprint FROM memories`).all() as Array<{ slug: string; fingerprint: string }>;
        const indexedMap = new Map(indexed.map(r => [this.slugToPath(r.slug), r.fingerprint] as const));

        // Direction B：DB 有而 FS 没了的 → 删 DB（FTS5 索引由下次 search 的 syncCorpus 对账）
        let pruned = 0;
        for (const [absPath] of indexedMap) {
            if (!fsFiles.has(absPath)) {
                const slug = this.pathToSlug(absPath);
                this.db.prepare(`DELETE FROM memories WHERE slug = ?`).run(slug);
                pruned++;
            }
        }

        // Direction A：FS 有但 DB 没 / fingerprint 变了 → upsert
        let indexedCount = 0;
        const now = Date.now();
        for (const absPath of fsFiles) {
            const slug = this.pathToSlug(absPath);
            const fingerprint = await this.computeFingerprint(absPath);
            const oldFp = indexedMap.get(absPath);
            if (oldFp === fingerprint) continue;

            const content = await fs.readFile(absPath, 'utf8');
            const title = this.parseTitle(content) ?? slug;
            // 外部编辑没有结构化 description，从 body 第二行起取首段非空作为 fallback
            const description = this.deriveDescription(content);

            this.db.prepare(`
                INSERT INTO memories (slug, title, description, body, fingerprint, created_at, updated_at)
                VALUES (@slug, @title, @description, @body, @fingerprint, @now, @now)
                ON CONFLICT(slug) DO UPDATE SET
                    title       = excluded.title,
                    description = excluded.description,
                    body        = excluded.body,
                    fingerprint = excluded.fingerprint,
                    updated_at  = excluded.updated_at
            `).run({ slug, title, description, body: content, fingerprint, now });
            indexedCount++;
        }

        return { indexed: indexedCount, pruned };
    }

    // ── transcript 抽取队列 ──

    async enqueueExtract(input: EnqueueExtractInput, now: number): Promise<ExtractJobRow | null> {
        try {
            const result = this.db.prepare(`
                INSERT INTO memory_extract_jobs (
                    thread_id, rollout_key, window_start_cursor, window_end_cursor,
                    turn_count, status, attempt_count, created_at
                ) VALUES (
                    @threadId, @rolloutKey, @windowStartCursor, @windowEndCursor,
                    @turnCount, 'pending', 0, @createdAt
                )
            `).run({ ...input, createdAt: now });
            return this.findExtractByIdSync(Number(result.lastInsertRowid));
        } catch (e: any) {
            if (e?.code === 'SQLITE_CONSTRAINT_UNIQUE') return null;
            throw e;
        }
    }

    async findExtractJob(id: number): Promise<ExtractJobRow | null> {
        return this.findExtractByIdSync(id);
    }

    async claimExtract(now: number, leaseMs: number, limit: number): Promise<ExtractJobRow[]> {
        const tx = this.db.transaction((nowTs: number, leaseDur: number, lim: number) => {
            const eligible = this.db.prepare(`
                SELECT id FROM memory_extract_jobs
                WHERE status = 'pending'
                   OR (status = 'claimed' AND lease_expires_at IS NOT NULL AND lease_expires_at < @now)
                   OR (status = 'failed' AND next_retry_at IS NOT NULL AND next_retry_at <= @now)
                ORDER BY id ASC
                LIMIT @limit
            `).all({ now: nowTs, limit: lim }) as Array<{ id: number }>;

            if (eligible.length === 0) return [] as ExtractJobRow[];

            const update = this.db.prepare(`
                UPDATE memory_extract_jobs
                SET status           = 'claimed',
                    leased_at        = @now,
                    lease_expires_at = @leaseExpiresAt,
                    attempt_count    = attempt_count + 1,
                    next_retry_at    = NULL
                WHERE id = @id
            `);
            const out: ExtractJobRow[] = [];
            for (const { id } of eligible) {
                update.run({ id, now: nowTs, leaseExpiresAt: nowTs + leaseDur });
                const row = this.findExtractByIdSync(id);
                if (row) out.push(row);
            }
            return out;
        });
        return tx(now, leaseMs, limit);
    }

    async finishExtractSuccess(id: number, now: number): Promise<void> {
        this.db.prepare(`
            UPDATE memory_extract_jobs
            SET status           = 'succeeded',
                finished_at      = @now,
                error_message    = NULL,
                leased_at        = NULL,
                lease_expires_at = NULL,
                next_retry_at    = NULL
            WHERE id = @id
        `).run({ id, now });
    }

    async finishExtractFailure(id: number, errorMessage: string, nextRetryAt: number | null, now: number): Promise<void> {
        this.db.prepare(`
            UPDATE memory_extract_jobs
            SET status           = 'failed',
                error_message    = @errorMessage,
                next_retry_at    = @nextRetryAt,
                finished_at      = @now,
                leased_at        = NULL,
                lease_expires_at = NULL
            WHERE id = @id
        `).run({ id, errorMessage: errorMessage.slice(0, 1000), nextRetryAt, now });
    }

    async findLatestCompletedWindowEnd(threadId: string): Promise<string | null> {
        const row = this.db.prepare(`
            SELECT window_end_cursor AS cursor
            FROM memory_extract_jobs
            WHERE thread_id = @threadId AND status = 'succeeded'
            ORDER BY CAST(window_end_cursor AS INTEGER) DESC
            LIMIT 1
        `).get({ threadId }) as { cursor: string } | undefined;
        return row?.cursor ?? null;
    }

    dispose(): void {
        this._searcher?.dispose();
        this._searcher = undefined;
        this._db?.close();
        this._db = undefined;
    }

    // ── 内部辅助 ──

    private slugToPath(slug: string): string {
        return path.join(this.memoriesDir, `${slug}.md`);
    }

    private pathToSlug(absPath: string): string {
        return path.basename(absPath, '.md');
    }

    private assertValidSlug(slug: string): void {
        if (!SLUG_RE.test(slug)) {
            throw new Error(`MemoryStore: invalid slug "${slug}" — must match ${SLUG_RE.source}`);
        }
    }

    private assembleBody(title: string, body: string): string {
        // 去掉 body 头部任何 H1（避免重复），重新拼 `# title\n\n<body>`
        const stripped = this.stripTitleLine(body).replace(/^\n+/, '');
        return `# ${title}\n\n${stripped}`.trimEnd() + '\n';
    }

    private stripTitleLine(content: string): string {
        const m = content.match(/^# .+\n+/);
        return m ? content.slice(m[0].length) : content;
    }

    private parseTitle(content: string): string | null {
        const m = content.match(/^# (.+?)\s*$/m);
        return m?.[1]?.trim() || null;
    }

    private deriveDescription(content: string): string {
        // 跳过 H1，取首段第一非空行作为 description（用于外部编辑兜底）
        const stripped = this.stripTitleLine(content);
        const lines = stripped.split(/\r?\n/);
        for (const line of lines) {
            const t = line.trim();
            if (!t) continue;
            // 截 200 字符
            return t.slice(0, 200);
        }
        return '';
    }

    private async computeFingerprint(absPath: string): Promise<string> {
        const stat = await fs.stat(absPath);
        return `${stat.size}-${stat.mtimeMs}`;
    }

    private findByIdSync(id: number): MemoryRow | null {
        const row = this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id);
        return row ? this.mapRow(row) : null;
    }

    private findExtractByIdSync(id: number): ExtractJobRow | null {
        const row = this.db.prepare(`SELECT * FROM memory_extract_jobs WHERE id = ?`).get(id);
        return row ? this.mapExtractRow(row) : null;
    }

    private mapRow(r: any): MemoryRow {
        return {
            id: r.id,
            slug: r.slug,
            title: r.title,
            description: r.description,
            body: r.body,
            fingerprint: r.fingerprint,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            lastReadAt: r.last_read_at,
            readCount: r.read_count,
        };
    }

    private mapExtractRow(r: any): ExtractJobRow {
        return {
            id: r.id,
            threadId: r.thread_id,
            rolloutKey: r.rollout_key,
            windowStartCursor: r.window_start_cursor,
            windowEndCursor: r.window_end_cursor,
            turnCount: r.turn_count,
            status: r.status as ExtractJobStatus,
            attemptCount: r.attempt_count,
            nextRetryAt: r.next_retry_at,
            leasedAt: r.leased_at,
            leaseExpiresAt: r.lease_expires_at,
            finishedAt: r.finished_at,
            errorMessage: r.error_message,
            createdAt: r.created_at,
        };
    }
}
