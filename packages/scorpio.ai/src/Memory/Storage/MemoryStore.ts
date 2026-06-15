import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "fs";
import * as fs from "fs/promises";
import path from "path";
import { inject } from "scorpio.di";
import { T_MemoryDir, T_MemoryDbPath } from "../../Core/tokens";
import {
    IMemoryStore,
    MemoryKind,
    type MemoryRow,
    type MemoryMenuEntry,
    type MemorySearchHit,
    type CreateMemoryInput,
    type UpdateMemoryInput,
    type PendingMessageRow,
    type PendingMessageStatus,
} from "./IMemoryStore";
import { HybridSearcher } from "../../Retrieval";
import type { ChatMessage } from "../../Saver";

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MEMORY_KINDS = new Set<string>(Object.values(MemoryKind));
const DEFAULT_KIND = MemoryKind.Fact;

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

    init(): void {
        if (!existsSync(this.memoriesDir)) mkdirSync(this.memoriesDir, { recursive: true });
        if (!existsSync(this.archiveDir)) mkdirSync(this.archiveDir, { recursive: true });
        // 触发 lazy init（DB schema + HybridSearcher 自管 searcher.sqlite）
        void this.db;
        void this.searcher;
    }

    /**
     * HybridSearcher 自管 SQLite（searcher.sqlite 在 rootDir 下）。
     * 与 memory.db 是两个独立文件：memory.db 装元数据 + 待处理消息队列；
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
                    kind         TEXT    NOT NULL DEFAULT 'fact',
                    title        TEXT    NOT NULL,
                    description  TEXT    NOT NULL,
                    body         TEXT    NOT NULL,
                    fingerprint  TEXT    NOT NULL,
                    evidence_count INTEGER NOT NULL DEFAULT 1,
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

                -- 旧的抽取作业表（被 memory_pending_messages 取代）。保留 DROP 兼容老库。
                DROP TABLE IF EXISTS memory_extract_jobs;

                -- 待处理消息队列：每轮对话结束直接入队 ChatMessage[] 快照，
                -- MemoryService 通过 isRunning 标志 + popOldestPending 串行消费；
                -- 失败行保留 status='failed'，不再自动重试，由 admin 决定。
                CREATE TABLE IF NOT EXISTS memory_pending_messages (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    messages_json TEXT    NOT NULL,
                    status        TEXT    NOT NULL DEFAULT 'pending',
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    error_message TEXT,
                    created_at    INTEGER NOT NULL,
                    updated_at    INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_pending_status_id ON memory_pending_messages(status, id);
            `);
            this.ensureMemoryColumns();
        }
        return this._db;
    }

    // ── CRUD ──

    async create(input: CreateMemoryInput, now: number): Promise<MemoryRow> {
        this.assertValidSlug(input.slug);
        const filePath = this.slugToPath(input.slug);
        const content = this.assembleBody(input.title, input.body);
        const evidenceCount = Math.max(1, input.evidenceCount ?? 1);

        await fs.writeFile(filePath, content, "utf8");
        const fingerprint = await this.computeFingerprint(filePath);

        try {
            const result = this.db.prepare(`
                INSERT INTO memories (
                    slug, kind, title, description, body, fingerprint,
                    evidence_count, created_at, updated_at
                )
                VALUES (
                    @slug, @kind, @title, @description, @body, @fingerprint,
                    @evidenceCount, @createdAt, @updatedAt
                )
            `).run({
                slug: input.slug,
                kind: this.normalizeKind(input.kind),
                title: input.title,
                description: input.description,
                body: content,
                fingerprint,
                evidenceCount,
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
        const newBodyRaw = input.body
            ? this.mergeBody(existing.body, input.body, input.bodyMode)
            : this.stripTitleLine(existing.body);
        const newContent = this.assembleBody(newTitle, newBodyRaw);
        const filePath = this.slugToPath(input.slug);
        const evidenceDelta = Math.max(0, input.evidenceDelta ?? 0);

        await fs.writeFile(filePath, newContent, "utf8");
        const fingerprint = await this.computeFingerprint(filePath);

        this.db.prepare(`
            UPDATE memories
            SET kind        = @kind,
                title       = @title,
                description = @description,
                body        = @body,
                fingerprint = @fingerprint,
                evidence_count = evidence_count + @evidenceDelta,
                updated_at  = @updatedAt
            WHERE slug = @slug
        `).run({
            slug: input.slug,
            kind: this.normalizeKind(input.kind ?? existing.kind),
            title: newTitle,
            description: newDescription,
            body: newContent,
            fingerprint,
            evidenceDelta,
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
            SELECT slug, kind, title, description, evidence_count
            FROM memories
            ORDER BY COALESCE(last_read_at, 0) DESC, evidence_count DESC, updated_at DESC
            LIMIT @limit
        `).all({ limit }) as Array<{ slug: string; kind: string; title: string; description: string; evidence_count: number }>;
        return rows.map(r => ({
            slug: r.slug,
            kind: this.normalizeKind(r.kind),
            title: r.title,
            description: r.description,
            evidenceCount: r.evidence_count ?? 1,
        }));
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
                kind: h.item.kind,
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

    // ── 待处理消息队列 ──

    pushPendingMessages(messages: ChatMessage[], now: number): number {
        const result = this.db.prepare(`
            INSERT INTO memory_pending_messages (
                messages_json, status, attempt_count, created_at, updated_at
            ) VALUES (
                @messagesJson, 'pending', 0, @now, @now
            )
        `).run({ messagesJson: JSON.stringify(messages), now });
        return Number(result.lastInsertRowid);
    }

    popPendingMessages(): PendingMessageRow | null {
        const row = this.db.prepare(`
            SELECT id, messages_json, status, attempt_count, error_message, created_at, updated_at
            FROM memory_pending_messages
            WHERE status = 'pending'
            ORDER BY id ASC
            LIMIT 1
        `).get() as any;
        if (!row) return null;
        return this.mapPendingRow(row);
    }

    deletePending(id: number): void {
        this.db.prepare(`DELETE FROM memory_pending_messages WHERE id = ?`).run(id);
    }

    markPendingFailed(id: number, errorMessage: string, now: number): void {
        this.db.prepare(`
            UPDATE memory_pending_messages
            SET status        = 'failed',
                error_message = @errorMessage,
                attempt_count = attempt_count + 1,
                updated_at    = @now
            WHERE id = @id
        `).run({ id, errorMessage: errorMessage.slice(0, 1000), now });
    }

    listPendingMessages(limit: number): PendingMessageRow[] {
        const rows = this.db.prepare(`
            SELECT id, messages_json, status, attempt_count, error_message, created_at, updated_at
            FROM memory_pending_messages
            ORDER BY id DESC
            LIMIT @limit
        `).all({ limit: Math.max(1, Math.min(limit, 200)) }) as any[];
        return rows.map(r => this.mapPendingRow(r));
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

    private normalizeKind(kind: string | undefined | null): MemoryKind {
        return MEMORY_KINDS.has(kind as MemoryKind) ? (kind as MemoryKind) : DEFAULT_KIND;
    }

    private mergeBody(existingBody: string, nextBody: string, mode: 'replace' | 'append' | undefined): string {
        const strippedExisting = this.stripTitleLine(existingBody).trim();
        const strippedNext = this.stripTitleLine(nextBody).trim();
        if (mode !== 'append' || !strippedExisting) return strippedNext;
        if (!strippedNext || strippedExisting.includes(strippedNext)) return strippedExisting;
        return `${strippedExisting}\n\n${strippedNext}`;
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

    private ensureMemoryColumns(): void {
        const columns = new Set((this._db!.prepare(`PRAGMA table_info(memories)`).all() as Array<{ name: string }>).map(c => c.name));
        const add = (name: string, sql: string) => {
            if (!columns.has(name)) this._db!.exec(sql);
        };
        add('kind', `ALTER TABLE memories ADD COLUMN kind TEXT NOT NULL DEFAULT 'fact'`);
        add('evidence_count', `ALTER TABLE memories ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 1`);
        // 老版本残留的 source_* 列保留在表里不删——SQLite ALTER 不便降列，
        // 实际使用上 mapRow 已不再读取，相当于 dead column。
    }

    private parsePendingMessages(json: string): ChatMessage[] {
        try {
            const parsed = JSON.parse(json);
            if (!Array.isArray(parsed)) return [];
            return parsed as ChatMessage[];
        } catch {
            return [];
        }
    }

    private mapRow(r: any): MemoryRow {
        return {
            id: r.id,
            slug: r.slug,
            kind: this.normalizeKind(r.kind),
            title: r.title,
            description: r.description,
            body: r.body,
            fingerprint: r.fingerprint,
            evidenceCount: r.evidence_count ?? 1,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
            lastReadAt: r.last_read_at,
            readCount: r.read_count,
        };
    }

    private mapPendingRow(r: any): PendingMessageRow {
        return {
            id: r.id,
            messages: this.parsePendingMessages(r.messages_json),
            status: (r.status as PendingMessageStatus) ?? 'pending',
            attemptCount: r.attempt_count ?? 0,
            errorMessage: r.error_message ?? null,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        };
    }
}
