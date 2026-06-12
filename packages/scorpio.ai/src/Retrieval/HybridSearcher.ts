import path from "path";
import { existsSync, mkdirSync } from "fs";
import Database from "better-sqlite3";
import { IEmbeddingService } from "../Embedding";
import { cosineSimilarity } from "../Note/utils";

/**
 * 自管 SQLite 的混合检索器。
 *
 * 三个独立评分原语 + 一个加权融合 + 一个批量检索：
 *   matchEmbedding(q, t) → embedding cosine（需 embeddingModel）
 *   matchBM25(q, t)      → BM25（基于持久 corpus）
 *   match(q, t)          → 上面两路加权融合
 *   search(q, items, toText) → 批量 top-k
 *
 * cachePath 必传：searcher.sqlite 落到此目录下。
 * embeddingModel 不传 → matchEmbedding 永远 0，融合时权重让给 BM25。
 *
 * 文件布局：`<cachePath>/searcher.sqlite`
 *   embeddings(key TEXT PK = 原文, embedding BLOB, created_at)
 *   docs(rowid, key UNIQUE = 原文, text) + docs_fts(text)
 *
 * docs / embeddings 都用文本本身当 key —— 同一段 text 在不同语境共享一行，
 * embedding 只算一次，FTS5 行只插一次。
 */
export interface HybridSearcherOptions {
    /** 持久化目录。searcher.sqlite 落到此目录下。 */
    cachePath: string;
    embeddingModel?: IEmbeddingService;
    embeddingWeight?: number;
    bm25Weight?: number;
    /** search() 命中分数阈值，默认 0.05。 */
    minScore?: number;
}

const DEFAULT_EMB_W = 0.6;
const DEFAULT_BM25_W = 0.4;
const DEFAULT_MIN_SCORE = 0.05;

/** BM25 raw → [0,1] 归一化。raw bm25 ∈ ~[-20, 0]，越负越好。 */
const BM25_NORM_SCALE = 8;

export class HybridSearcher {
    private readonly embeddingModel?: IEmbeddingService;
    private readonly db: Database.Database;
    /** 内存层 embedding 缓存，key = 原文。SQLite 命中后回填这里。 */
    private readonly memCache = new Map<string, number[]>();
    private readonly w: { emb: number; bm25: number };
    private readonly minScore: number;
    private disposed = false;

    constructor(options: HybridSearcherOptions) {
        this.embeddingModel = options.embeddingModel;
        this.w = {
            emb:  options.embeddingWeight ?? DEFAULT_EMB_W,
            bm25: options.bm25Weight     ?? DEFAULT_BM25_W,
        };
        this.minScore = options.minScore ?? DEFAULT_MIN_SCORE;

        if (!existsSync(options.cachePath)) mkdirSync(options.cachePath, { recursive: true });
        this.db = new Database(path.join(options.cachePath, "searcher.sqlite"));
        this.db.pragma("journal_mode = WAL");
        this.initSchema();
    }

    // ── 评分原语 ────────────────────────────────────────────────────────

    /**
     * Embedding cosine 相似度，映射到 [0,1]。
     * 没 embeddingModel 或调用失败 → 0。
     */
    async matchEmbedding(query: string, text: string): Promise<number> {
        if (!this.embeddingModel || !query || !text) return 0;
        try {
            const [qVec, tVec] = await Promise.all([
                this.getOrCreateEmbedding(query),
                this.getOrCreateEmbedding(text),
            ]);
            if (!qVec || !tVec) return 0;
            return (cosineSimilarity(qVec, tVec, vectorNorm(qVec)) + 1) / 2;
        } catch {
            return 0;
        }
    }

    /**
     * BM25 评分，映射到 [0,1]。
     *
     * 把 text 当作 corpus 中的一条 doc（key = text，幂等插入），用 FTS5 MATCH(query)
     * 拿到这一行的 bm25 值；IDF 来自整个累积 corpus（包含历次 search() / matchBM25 调用）。
     *
     * query 提不出 token / 该行没命中 → 0。
     */
    async matchBM25(query: string, text: string): Promise<number> {
        if (!query || !text) return 0;
        const fts = buildFtsQuery(query);
        if (!fts) return 0;

        this.upsertDoc(text);

        const row = this.db.prepare(`
            SELECT bm25(docs_fts) AS score
            FROM docs_fts JOIN docs d ON d.rowid = docs_fts.rowid
            WHERE d.key = @key AND docs_fts MATCH @fts
        `).get({ key: text, fts }) as { score: number } | undefined;

        return row ? normalizeBm25(row.score) : 0;
    }

    /**
     * 综合评分：matchEmbedding + matchBM25 加权融合。
     * 没 embeddingModel 时 emb 永远 0，权重自动归 BM25 全占。
     */
    async match(query: string, text: string): Promise<number> {
        const [emb, bm25] = await Promise.all([
            this.matchEmbedding(query, text),
            this.matchBM25(query, text),
        ]);
        const useEmb = !!this.embeddingModel;
        const tw = (useEmb ? this.w.emb : 0) + this.w.bm25;
        if (tw === 0) return 0;
        const ew = useEmb ? this.w.emb / tw : 0;
        const bw = this.w.bm25 / tw;
        return ew * emb + bw * bm25;
    }

    // ── 批量检索 ────────────────────────────────────────────────────────

    /**
     * 在 items 中 top-k 检索。
     *
     * `toText(item)` 返回该 item 的匹配文本（同时用于 BM25 和 embedding）。
     * Wiki 推荐返回标题；Memory 推荐返回 `title + body`。返回空串的 item 直接跳过。
     *
     * 实现：
     * 1. 把所有 text 同步到 docs/docs_fts（去重；删除已不在的 key）
     * 2. 一次 FTS5 query 拿候选 + bm25 + snippet
     * 3. 候选集逐条调 matchEmbedding 补向量分
     * 4. 加权融合 → 排序 → 截断
     */
    async search<T>(
        query: string,
        items: T[],
        toText: (item: T) => string,
        limit: number,
    ): Promise<{ item: T; score: number; snippet?: string }[]> {
        if (items.length === 0) return [];

        const texts = items.map(toText);
        const uniqueTexts = [...new Set(texts.filter(Boolean))];
        if (uniqueTexts.length === 0) return [];

        this.syncCorpus(uniqueTexts);

        const { bm25ByText, snippetByText } = this.ftsBatch(query, limit);

        // BM25 0 命中 → 仍允许所有 item 走 embedding
        const candidates = bm25ByText.size > 0
            ? new Set(bm25ByText.keys())
            : new Set(uniqueTexts);

        const useEmb = !!this.embeddingModel;
        const tw = (useEmb ? this.w.emb : 0) + this.w.bm25;
        const ew = tw > 0 && useEmb ? this.w.emb / tw : 0;
        const bw = tw > 0 ? this.w.bm25 / tw : 0;

        const tasks = items.map(async (item, i) => {
            const text = texts[i];
            if (!text || !candidates.has(text)) return null;
            const bm25 = bm25ByText.get(text) ?? 0;
            const emb = useEmb ? await this.matchEmbedding(query, text) : 0;
            return {
                item,
                score: ew * emb + bw * bm25,
                snippet: snippetByText.get(text),
            };
        });
        const results = (await Promise.all(tasks))
            .filter((r): r is NonNullable<typeof r> => r !== null);

        return results
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .filter(r => r.score > this.minScore);
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.db.close();
    }

    // ── 内部 ──────────────────────────────────────────────────────────

    /** 一次 FTS5 query 拿所有命中的 bm25 + snippet（key = text）。 */
    private ftsBatch(query: string, limit: number): {
        bm25ByText: Map<string, number>;
        snippetByText: Map<string, string>;
    } {
        const bm25ByText = new Map<string, number>();
        const snippetByText = new Map<string, string>();
        const fts = buildFtsQuery(query);
        if (!fts) return { bm25ByText, snippetByText };

        const limitN = Math.max(limit * 3, limit);
        const rows = this.db.prepare(`
            SELECT d.key                                       AS key,
                   bm25(docs_fts)                              AS score,
                   snippet(docs_fts, 0, '<<', '>>', '...', 32) AS snippet
            FROM docs_fts JOIN docs d ON d.rowid = docs_fts.rowid
            WHERE docs_fts MATCH @fts
            ORDER BY score
            LIMIT @limit
        `).all({ fts, limit: limitN }) as Array<{ key: string; score: number; snippet: string }>;
        for (const r of rows) {
            bm25ByText.set(r.key, normalizeBm25(r.score));
            snippetByText.set(r.key, r.snippet);
        }
        return { bm25ByText, snippetByText };
    }

    private upsertDoc(text: string): void {
        this.db.prepare(`
            INSERT INTO docs (key, text) VALUES (?, ?)
            ON CONFLICT(key) DO NOTHING
        `).run(text, text);
    }

    /** docs / docs_fts 与给定 texts 对账：插入新增 + 删除已不在的 key。 */
    private syncCorpus(texts: string[]): void {
        const seen = new Set(texts);
        const upsert = this.db.prepare(`
            INSERT INTO docs (key, text) VALUES (?, ?)
            ON CONFLICT(key) DO NOTHING
        `);
        const delByKey = this.db.prepare(`DELETE FROM docs WHERE key = ?`);
        const tx = this.db.transaction(() => {
            for (const t of seen) upsert.run(t, t);
            const all = this.db.prepare(`SELECT key FROM docs`).all() as Array<{ key: string }>;
            for (const r of all) {
                if (!seen.has(r.key)) delByKey.run(r.key);
            }
        });
        tx();
    }

    private async getOrCreateEmbedding(text: string): Promise<number[] | undefined> {
        if (!text) return undefined;

        const mem = this.memCache.get(text);
        if (mem) return mem;

        const row = this.db.prepare(`SELECT embedding FROM embeddings WHERE key = ?`)
            .get(text) as { embedding: Buffer } | undefined;
        if (row) {
            const vec = bufToVec(row.embedding);
            this.memCache.set(text, vec);
            return vec;
        }

        if (!this.embeddingModel) return undefined;
        const vec = await this.embeddingModel.embedQuery(text);
        this.memCache.set(text, vec);
        this.db.prepare(`
            INSERT INTO embeddings (key, embedding, created_at)
            VALUES (@key, @embedding, @createdAt)
            ON CONFLICT(key) DO NOTHING
        `).run({
            key: text,
            embedding: vecToBuf(vec),
            createdAt: Date.now(),
        });
        return vec;
    }

    private initSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS embeddings (
                key        TEXT    PRIMARY KEY,
                embedding  BLOB    NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS docs (
                rowid INTEGER PRIMARY KEY AUTOINCREMENT,
                key   TEXT NOT NULL UNIQUE,
                text  TEXT NOT NULL
            );

            CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
                text,
                content='docs',
                content_rowid='rowid',
                tokenize='unicode61 remove_diacritics 1'
            );

            CREATE TRIGGER IF NOT EXISTS docs_ai AFTER INSERT ON docs BEGIN
                INSERT INTO docs_fts(rowid, text) VALUES (NEW.rowid, NEW.text);
            END;
            CREATE TRIGGER IF NOT EXISTS docs_ad AFTER DELETE ON docs BEGIN
                INSERT INTO docs_fts(docs_fts, rowid, text) VALUES ('delete', OLD.rowid, OLD.text);
            END;
            CREATE TRIGGER IF NOT EXISTS docs_au AFTER UPDATE ON docs BEGIN
                INSERT INTO docs_fts(docs_fts, rowid, text) VALUES ('delete', OLD.rowid, OLD.text);
                INSERT INTO docs_fts(rowid, text) VALUES (NEW.rowid, NEW.text);
            END;
        `);
    }
}

// ── 辅助 ──

/**
 * 自由文本 → FTS5 MATCH 表达式。
 *
 * - FTS5 MATCH 语法对 `"`、`(`、`*`、`:` 等特殊字符敏感，原始用户字符串直接喂会崩 parser。
 *   每个 token phrase-quote 后再 OR-join，绕过所有特殊字符问题。
 * - 用 OR 而非 AND：长查询里只要一个词没存就归零；OR 让 BM25 按"命中几个 / 多稀有"排序。
 * - `\p{L}` 包含 CJK 字符，中文也能 tokenize。
 *
 * 返回 null 表示提不出有效 token，调用方应直接当"空查询，0 结果"，不要喂给 SQL。
 */
function buildFtsQuery(raw: string): string | null {
    const tokens =
        raw
            .match(/[\p{L}\p{N}_]+/gu)
            ?.map(t => t.trim())
            .filter(Boolean) ?? [];
    if (tokens.length === 0) return null;
    const quoted = tokens.map(t => `"${t.replaceAll('"', "")}"`);
    return quoted.join(" OR ");
}

function vectorNorm(v: number[]): number {
    let s = 0;
    for (const x of v) s += x * x;
    return Math.sqrt(s);
}

/** raw bm25 (lower=better, ~[-20, 0]) → [0, 1] (higher=better) */
function normalizeBm25(raw: number): number {
    if (raw >= 0) return 0;
    return 1 - Math.exp(raw / BM25_NORM_SCALE);
}

function vecToBuf(v: number[]): Buffer {
    const f = new Float32Array(v);
    return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}

function bufToVec(buf: Buffer): number[] {
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    return Array.from(new Float32Array(ab));
}
