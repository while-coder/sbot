import Database from "better-sqlite3";
import { createHash } from "crypto";
import { existsSync, mkdirSync } from "fs";
import * as fs from "fs/promises";
import path from "path";
import { inject } from "scorpio.di";
import { T_MemoryDir, T_MemoryDbPath } from "../tokens";
import {
    IMemoryStore,
    MemoryKind,
    type StoredMemoryRow,
    type StoredMemoryMenuEntry,
    type StoredMemorySearchHit,
    type CreateMemoryInput,
    type UpdateMemoryInput,
    MemoryPendingJobType,
    type PendingMemoryJobRow,
    type MemoryPendingJobStatus,
    type MemoryWorkspaceScope,
    type MemoryTarget,
    MemoryScope,
} from "./IMemoryStore";
import { HybridSearcher, MessageRole, type ChatMessage } from "scorpio.ai";

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

                CREATE TABLE IF NOT EXISTS memory_pending_remember_messages (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    content         TEXT    NOT NULL,
                    requested_scope TEXT    NOT NULL,
                    workspace_key   TEXT,
                    created_at      INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_pending_remember_workspace_id
                    ON memory_pending_remember_messages(workspace_key, id);
            `);
            // 旧库去列：description 曾是独立的 menu 标签，现已并入 title（= 文件 H1）。
            // 不搬运旧值（老条目的 menu 行退化成当时那个短标题，consolidate 会逐步重写），
            // 但列必须删掉——它是 NOT NULL 无默认值，留着会让新的 INSERT 直接失败。
            try {
                this._db.exec(`ALTER TABLE memories DROP COLUMN description`);
            } catch { /* 列不存在（新库）→ 正常 */ }

            // 启动 sweep：把上次进程崩溃留下的 'processing' 转回 'pending' 重新跑。
            // 'processing' 是 popPendingJob 拿走 job 时打上的临时状态——配合该 sweep
            // 实现"崩溃恢复时不重复 LLM 调用"：只有走完 deletePendingJob 才会真正消失。
            this._db.prepare(`UPDATE memory_pending_messages SET status = 'pending' WHERE status = 'processing'`).run();
        }
        return this._db;
    }

    // ── CRUD ──

    async create(input: CreateMemoryInput, now: number): Promise<StoredMemoryRow> {
        this.assertValidSlug(input.slug);
        const filePath = this.slugToPath(input.slug);

        // 冲突必须在写文件之前拦下。否则 writeFile 会先覆盖已有条目的内容，
        // 随后 INSERT 撞 UNIQUE，下面 catch 里的 unlink 回滚把那个文件一起删掉——
        // DB 行却还在，FS/DB 不一致，下一轮 reconcile 会连 DB 行一起清，整条记忆就没了。
        // 用文件存在性而不是 getBySlug 判断：外部手写但还没 reconcile 的 .md 同样不能被覆盖。
        if (existsSync(filePath)) {
            throw new Error(`MemoryStore.create: slug already exists: ${input.slug}`);
        }

        const content = this.assembleBody(input.title, input.body);
        const evidenceCount = Math.max(1, input.evidenceCount ?? 1);

        // fingerprint 由 content 直接算（sha256），不依赖 mtime——
        // 触摸文件不改内容时 reconcile 不会误判变化、白跑一次重建索引。
        const fingerprint = this.computeContentFingerprint(content);
        await fs.writeFile(filePath, content, "utf8");

        try {
            const result = this.db.prepare(`
                INSERT INTO memories (
                    slug, kind, title, body, fingerprint,
                    evidence_count, created_at, updated_at
                )
                VALUES (
                    @slug, @kind, @title, @body, @fingerprint,
                    @evidenceCount, @createdAt, @updatedAt
                )
            `).run({
                slug: input.slug,
                kind: this.normalizeKind(input.kind),
                title: input.title,
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

    async update(input: UpdateMemoryInput, now: number): Promise<StoredMemoryRow> {
        const existing = await this.getBySlug(input.slug);
        if (!existing) throw new Error(`MemoryStore.update: slug not found: ${input.slug}`);

        const newTitle = input.title ?? existing.title;
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
                body        = @body,
                fingerprint = @fingerprint,
                evidence_count = evidence_count + @evidenceDelta,
                updated_at  = @updatedAt
            WHERE slug = @slug
        `).run({
            slug: input.slug,
            kind: this.normalizeKind(input.kind ?? existing.kind),
            title: newTitle,
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

    async getBySlug(slug: string): Promise<StoredMemoryRow | null> {
        const row = this.db.prepare(`SELECT * FROM memories WHERE slug = ?`).get(slug);
        return row ? this.mapRow(row) : null;
    }

    async list(): Promise<StoredMemoryRow[]> {
        const rows = this.db.prepare(`SELECT * FROM memories ORDER BY updated_at DESC`).all() as any[];
        return rows.map(r => this.mapRow(r));
    }

    async listMenu(limit: number): Promise<StoredMemoryMenuEntry[]> {
        // 注入 system prompt 用：常被读 + 最近更新优先
        const rows = this.db.prepare(`
            SELECT slug, kind, title, evidence_count
            FROM memories
            ORDER BY COALESCE(last_read_at, 0) DESC, evidence_count DESC, updated_at DESC
            LIMIT @limit
        `).all({ limit }) as Array<{ slug: string; kind: string; title: string; evidence_count: number }>;
        return rows.map(r => ({
            slug: r.slug,
            kind: this.normalizeKind(r.kind),
            title: r.title,
            evidenceCount: r.evidence_count ?? 1,
        }));
    }

    // ── 检索 ──

    async search(query: string, limit: number, floorRatio: number): Promise<StoredMemorySearchHit[]> {
        // 把当前所有 memories 喂进 HybridSearcher（内部 syncCorpus 自动对账 docs / docs_fts）。
        // floorRatio 在归一化分数 [0,1] 上做：保留 #1，其余按 top * floorRatio 截断。
        const all = await this.list();
        if (all.length === 0) return [];

        const fetchLimit = Math.min(limit * 3, 50);
        const hits = await this.searcher.search(
            query,
            all,
            // 只喂 body：它已经以 `# title` 开头，再单独拼一次 title 会让标题词在 BM25 里权重翻倍。
            (row) => row.body,
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
                evidenceCount: h.item.evidenceCount,
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

        // Direction A：FS 有但 DB 没 / fingerprint 变了。
        // 一条 UPSERT 就够：title 是文件 H1 的解析结果，body 就是文件本身，
        // 两个字段都能从 FS 无损重建，不存在"DB 里有而文件里没有、覆盖就丢"的字段。
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

            this.db.prepare(`
                INSERT INTO memories (slug, title, body, fingerprint, created_at, updated_at)
                VALUES (@slug, @title, @body, @fingerprint, @now, @now)
                ON CONFLICT(slug) DO UPDATE
                    SET title       = excluded.title,
                        body        = excluded.body,
                        fingerprint = excluded.fingerprint,
                        updated_at  = excluded.updated_at
                    WHERE memories.fingerprint != excluded.fingerprint
            `).run({ slug, title, body: content, fingerprint, now });
            indexedCount++;
        }

        return { indexed: indexedCount, pruned };
    }

    // ── 待处理 job 队列 ──

    pushPendingRememberMessage(content: string, scope: MemoryScope, now: number, target: MemoryTarget): number {
        const result = this.db.prepare(`
            INSERT INTO memory_pending_remember_messages (content, requested_scope, workspace_key, created_at)
            VALUES (@content, @scope, @workspaceKey, @now)
        `).run({
            content,
            scope,
            workspaceKey: target.scope === MemoryScope.Workspace ? target.workspace.key : null,
            now,
        });
        return Number(result.lastInsertRowid);
    }

    pushPendingMessages(messages: ChatMessage[], now: number, target: MemoryTarget): number {
        const workspaceKey = target.scope === MemoryScope.Workspace ? target.workspace.key : null;
        return this.db.transaction(() => {
            const where = workspaceKey === null ? `workspace_key IS NULL` : `workspace_key = @workspaceKey`;
            const params = workspaceKey === null ? {} : { workspaceKey };
            const pending = this.db.prepare(`
                SELECT content, requested_scope FROM memory_pending_remember_messages
                WHERE ${where} ORDER BY id ASC
            `).all(params) as Array<{ content: string; requested_scope: string }>;
            const jobMessages: ChatMessage[] = pending.length === 0 ? messages : pending.map(row => ({
                role: MessageRole.Human,
                content: `[EXPLICIT MEMORY WRITE]\nRequired scope: ${row.requested_scope}\n\n${row.content}`,
                additional_kwargs: { explicitMemory: true, memoryScope: row.requested_scope },
            }));
            const jobId = this.pushPendingJob(MemoryPendingJobType.Extract, { messages: jobMessages, ...target }, now);
            if (pending.length > 0) {
                this.db.prepare(`DELETE FROM memory_pending_remember_messages WHERE ${where}`).run(params);
            }
            return jobId;
        })();
    }

    pushPendingConsolidate(now: number, target: MemoryTarget): number {
        return this.pushPendingJob(MemoryPendingJobType.Consolidate, target, now);
    }

    pushPendingReconcile(now: number, target: MemoryTarget): number {
        return this.pushPendingJob(MemoryPendingJobType.Reconcile, target, now);
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

    retryFailedJob(id: number, now: number, target: MemoryTarget): boolean {
        const workspaceKey = target.scope === MemoryScope.Workspace ? target.workspace.key : null;
        const scopeWhere = workspaceKey === null
            ? `json_extract(payload_json, '$.workspace.key') IS NULL`
            : `json_extract(payload_json, '$.workspace.key') = @workspaceKey`;
        const result = this.db.prepare(`
            UPDATE memory_pending_messages
            SET status        = 'pending',
                error_message = NULL,
                updated_at    = @now
            WHERE id = @id
              AND status = 'failed'
              AND ${scopeWhere}
        `).run({
            id,
            now,
            ...(workspaceKey ? { workspaceKey } : {}),
        });
        return result.changes > 0;
    }

    deleteFailedJob(id: number, target: MemoryTarget): boolean {
        const workspaceKey = target.scope === MemoryScope.Workspace ? target.workspace.key : null;
        const scopeWhere = workspaceKey === null
            ? `json_extract(payload_json, '$.workspace.key') IS NULL`
            : `json_extract(payload_json, '$.workspace.key') = @workspaceKey`;
        const result = this.db.prepare(`
            DELETE FROM memory_pending_messages
            WHERE id = @id
              AND status = 'failed'
              AND ${scopeWhere}
        `).run({
            id,
            ...(workspaceKey ? { workspaceKey } : {}),
        });
        return result.changes > 0;
    }

    listPendingJobs(limit: number, target: MemoryTarget): PendingMemoryJobRow[] {
        const workspaceKey = target.scope === MemoryScope.Workspace ? target.workspace.key : null;
        const scopeWhere = workspaceKey === null
            ? `WHERE json_extract(payload_json, '$.workspace.key') IS NULL`
            : `WHERE json_extract(payload_json, '$.workspace.key') = @workspaceKey`;
        const rows = this.db.prepare(`
            SELECT id, job_type, payload_json, status, attempt_count, error_message, created_at, updated_at
            FROM memory_pending_messages
            ${scopeWhere}
            ORDER BY id DESC
            LIMIT @limit
        `).all({
            limit: Math.max(1, Math.min(limit, 200)),
            ...(workspaceKey ? { workspaceKey } : {}),
        }) as any[];
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

    /**
     * Content-based fingerprint (sha256 of the bytes that get written to disk).
     * 用 mtime 做 fingerprint 的旧实现会被 IDE 自动保存 / git checkout / rsync 触发误判，
     * 让 reconcile 白跑一轮重建索引。
     */
    private computeContentFingerprint(content: string): string {
        return createHash('sha256').update(content, 'utf8').digest('hex');
    }

    private findByIdSync(id: number): StoredMemoryRow | null {
        const row = this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id);
        return row ? this.mapRow(row) : null;
    }

    private parsePendingPayload(json: string | null | undefined): { messages?: ChatMessage[]; target: MemoryTarget } {
        try {
            const parsed = JSON.parse(json ?? '{}');
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                return { target: { scope: MemoryScope.Global } };
            }
            const messages = Array.isArray((parsed as any).messages) ? ((parsed as any).messages as ChatMessage[]) : undefined;
            const rawWorkspace = (parsed as any).workspace;
            const workspace = rawWorkspace
                && typeof rawWorkspace === 'object'
                && typeof rawWorkspace.key === 'string'
                && typeof rawWorkspace.path === 'string'
                ? { key: rawWorkspace.key, path: rawWorkspace.path }
                : undefined;
            const target: MemoryTarget = workspace
                ? { scope: MemoryScope.Workspace, workspace }
                : { scope: MemoryScope.Global };
            return { ...(messages ? { messages } : {}), target };
        } catch {
            return { target: { scope: MemoryScope.Global } };
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

    private mapRow(r: any): StoredMemoryRow {
        return {
            id: r.id,
            slug: r.slug,
            kind: this.normalizeKind(r.kind),
            title: r.title,
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
        const base = {
            id: r.id,
            type,
            messages: type === MemoryPendingJobType.Extract ? (payload.messages ?? []) : undefined,
            status: this.normalizePendingStatus(r.status),
            attemptCount: r.attempt_count ?? 0,
            errorMessage: r.error_message ?? null,
            createdAt: r.created_at,
            updatedAt: r.updated_at,
        };
        return payload.target.scope === MemoryScope.Workspace
            ? { ...base, scope: MemoryScope.Workspace, workspace: payload.target.workspace }
            : { ...base, scope: MemoryScope.Global };
    }
}
