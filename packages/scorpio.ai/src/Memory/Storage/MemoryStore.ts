import Database from "better-sqlite3";
import { createHash } from "crypto";
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
    MemoryPendingJobType,
    type PendingMemoryJobRow,
    type MemoryPendingJobStatus,
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
        // mkdir 是 init 时唯一必须 eager 做的副作用：reconcile / softDelete / create
        // 都需要这两个目录已存在。db / searcher 仍走 lazy getter，第一次用时自动建。
        if (!existsSync(this.memoriesDir)) mkdirSync(this.memoriesDir, { recursive: true });
        if (!existsSync(this.archiveDir)) mkdirSync(this.archiveDir, { recursive: true });
    }

    /**
     * HybridSearcher 自管 SQLite（searcher.sqlite 在 rootDir 下）。
     * 与 memory.db 是两个独立文件：memory.db 装元数据 + 待处理 job 队列；
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

                -- 待处理 job 队列：抽取、整理与手动对账都入队，MemoryService 通过 isRunning 标志串行消费；
                -- 失败行保留 status='failed'，不再自动重试，由 admin 决定。
                CREATE TABLE IF NOT EXISTS memory_pending_messages (
                    id            INTEGER PRIMARY KEY AUTOINCREMENT,
                    job_type      TEXT    NOT NULL DEFAULT 'extract',
                    payload_json  TEXT    NOT NULL DEFAULT '{}',
                    status        TEXT    NOT NULL DEFAULT 'pending',
                    attempt_count INTEGER NOT NULL DEFAULT 0,
                    error_message TEXT,
                    created_at    INTEGER NOT NULL,
                    updated_at    INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_pending_status_id ON memory_pending_messages(status, id);
            `);
            // 启动 sweep：把上次进程崩溃留下的 'processing' 转回 'pending' 重新跑。
            // 'processing' 是 popPendingJob 拿走 job 时打上的临时状态——配合该 sweep
            // 实现"崩溃恢复时不重复 LLM 调用"：只有走完 deletePendingJob 才会真正消失。
            this._db.prepare(`UPDATE memory_pending_messages SET status = 'pending' WHERE status = 'processing'`).run();
        }
        return this._db;
    }

    // ── CRUD ──

    async create(input: CreateMemoryInput, now: number): Promise<MemoryRow> {
        this.assertValidSlug(input.slug);
        const filePath = this.slugToPath(input.slug);
        const content = this.assembleBody(input.title, input.body);
        const evidenceCount = Math.max(1, input.evidenceCount ?? 1);

        // fingerprint 由 content 直接算（sha256），不依赖 mtime——
        // 触摸文件不改内容时 reconcile 不会误判变化覆盖 description。
        const fingerprint = this.computeContentFingerprint(content);
        await fs.writeFile(filePath, content, "utf8");

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

        // 先算 fingerprint（同步），再写 FS、再写 DB——把 fs.stat 那次 await 砍掉，
        // FS-DB 不一致窗口只剩 fs.writeFile 到 db.prepare().run() 之间。
        const fingerprint = this.computeContentFingerprint(newContent);
        await fs.writeFile(filePath, newContent, "utf8");

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

        // Direction A：FS 有但 DB 没 / fingerprint 变了
        // INSERT 走 fallback description；UPDATE 不动 description（保护 writer LLM 写的精心值）。
        // 启动期 reconcile 与 drain 并发 create 时，UPSERT-with-description-overwrite 会用 deriveDescription
        // 覆盖 writer 刚写的描述——拆成两步避免这个 race。
        let indexedCount = 0;
        const now = Date.now();
        for (const absPath of fsFiles) {
            const slug = this.pathToSlug(absPath);
            const content = await fs.readFile(absPath, 'utf8');
            const fingerprint = this.computeContentFingerprint(content);

            // 重新读 fingerprint（不用启动期 snapshot），躲过 reconcile-期间-create 的 race。
            const current = this.db.prepare(`SELECT fingerprint FROM memories WHERE slug = ?`).get(slug) as { fingerprint: string } | undefined;
            if (current?.fingerprint === fingerprint) continue;

            const title = this.parseTitle(content) ?? slug;

            if (!current) {
                // 新行：description 用 fallback（外部新增文件没有结构化 description）。
                const description = this.deriveDescription(content);
                this.db.prepare(`
                    INSERT OR IGNORE INTO memories (slug, title, description, body, fingerprint, created_at, updated_at)
                    VALUES (@slug, @title, @description, @body, @fingerprint, @now, @now)
                `).run({ slug, title, description, body: content, fingerprint, now });
            } else {
                // 已存在：仅在 fingerprint 不一致时更新内容字段，**不动 description**。
                this.db.prepare(`
                    UPDATE memories
                    SET title       = @title,
                        body        = @body,
                        fingerprint = @fingerprint,
                        updated_at  = @now
                    WHERE slug = @slug AND fingerprint != @fingerprint
                `).run({ slug, title, body: content, fingerprint, now });
            }
            indexedCount++;
        }

        return { indexed: indexedCount, pruned };
    }

    // ── 待处理 job 队列 ──

    pushPendingMessages(messages: ChatMessage[], now: number): number {
        return this.pushPendingJob(MemoryPendingJobType.Extract, { messages }, now);
    }

    pushPendingConsolidate(now: number): number {
        return this.pushPendingJob(MemoryPendingJobType.Consolidate, {}, now);
    }

    pushPendingReconcile(now: number): number {
        return this.pushPendingJob(MemoryPendingJobType.Reconcile, {}, now);
    }

    private pushPendingJob(type: MemoryPendingJobType, payload: unknown, now: number): number {
        const result = this.db.prepare(`
            INSERT INTO memory_pending_messages (
                job_type, payload_json, status, attempt_count, created_at, updated_at
            ) VALUES (
                @jobType, @payloadJson, 'pending', 0, @now, @now
            )
        `).run({ jobType: type, payloadJson: JSON.stringify(payload), now });
        return Number(result.lastInsertRowid);
    }

    popPendingJob(): PendingMemoryJobRow | null {
        // 单条 SQL 原子地把最早 pending 转为 processing 并返回——崩溃时不会重复消费。
        // 'processing' 行由进程下次打开 DB 时的 sweep 转回 'pending'。
        const row = this.db.prepare(`
            UPDATE memory_pending_messages
            SET status = 'processing', updated_at = @now
            WHERE id = (
                SELECT id FROM memory_pending_messages
                WHERE status = 'pending'
                ORDER BY id ASC
                LIMIT 1
            )
            RETURNING id, job_type, payload_json, status, attempt_count, error_message, created_at, updated_at
        `).get({ now: Date.now() }) as any;
        if (!row) return null;
        return this.mapPendingRow(row);
    }

    deletePendingJob(id: number): void {
        this.db.prepare(`DELETE FROM memory_pending_messages WHERE id = ?`).run(id);
    }

    markPendingJobFailed(id: number, errorMessage: string, now: number): void {
        this.db.prepare(`
            UPDATE memory_pending_messages
            SET status        = 'failed',
                error_message = @errorMessage,
                attempt_count = attempt_count + 1,
                updated_at    = @now
            WHERE id = @id
        `).run({ id, errorMessage: errorMessage.slice(0, 1000), now });
    }

    retryFailedExtractJob(id: number, now: number): boolean {
        const result = this.db.prepare(`
            UPDATE memory_pending_messages
            SET status        = 'pending',
                error_message = NULL,
                updated_at    = @now
            WHERE id = @id
              AND status = 'failed'
              AND job_type = @jobType
        `).run({ id, now, jobType: MemoryPendingJobType.Extract });
        return result.changes > 0;
    }

    listPendingJobs(limit: number): PendingMemoryJobRow[] {
        const rows = this.db.prepare(`
            SELECT id, job_type, payload_json, status, attempt_count, error_message, created_at, updated_at
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

    async deleteAll(): Promise<void> {
        // 调用方必须先 dispose() 关掉 sqlite handle，否则 Windows 上文件锁会让 rm 失败。
        await fs.rm(this.rootDir, { recursive: true, force: true });
        // dbPath 通常在 rootDir 内，rm 是 no-op；万一外置（force 忽略 ENOENT），单独再 rm 一次。
        await fs.rm(this.dbPath, { force: true });
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

    /**
     * Content-based fingerprint (sha256 of the bytes that get written to disk).
     * 用 mtime 做 fingerprint 的旧实现会被 IDE 自动保存 / git checkout / rsync 触发误判，
     * 让 reconcile 走 deriveDescription 兜底覆盖 writer LLM 写的 description。
     */
    private computeContentFingerprint(content: string): string {
        return createHash('sha256').update(content, 'utf8').digest('hex');
    }

    private findByIdSync(id: number): MemoryRow | null {
        const row = this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id);
        return row ? this.mapRow(row) : null;
    }

    private parsePendingPayload(json: string | null | undefined): { messages?: ChatMessage[] } {
        try {
            const parsed = JSON.parse(json ?? '{}');
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
            const messages = Array.isArray((parsed as any).messages) ? ((parsed as any).messages as ChatMessage[]) : undefined;
            return messages ? { messages } : {};
        } catch {
            return {};
        }
    }

    private normalizePendingJobType(type: string | undefined | null): MemoryPendingJobType {
        if (type === MemoryPendingJobType.Consolidate) return MemoryPendingJobType.Consolidate;
        if (type === MemoryPendingJobType.Reconcile) return MemoryPendingJobType.Reconcile;
        return MemoryPendingJobType.Extract;
    }

    private normalizePendingStatus(status: string | undefined | null): MemoryPendingJobStatus {
        return status === 'failed' ? 'failed' : 'pending';
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

    private mapPendingRow(r: any): PendingMemoryJobRow {
        const type = this.normalizePendingJobType(r.job_type);
        const payload = this.parsePendingPayload(r.payload_json);
        return {
            id: r.id,
            type,
            messages: type === MemoryPendingJobType.Extract ? (payload.messages ?? []) : undefined,
            status: this.normalizePendingStatus(r.status),
            attemptCount: r.attempt_count ?? 0,
            errorMessage: r.error_message ?? null,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        };
    }
}
