import path from "path";
import { existsSync, mkdirSync } from "fs";
import Database from "better-sqlite3";
import { IEmbeddingService } from "../Embedding";

/**
 * 自管 SQLite 的混合检索器。
 *
 * 三个独立评分原语 + 一个加权融合 + 一个批量检索：
 *   matchEmbedding(q, t) → max(cos, 0) ∈ [0,1]（需 embeddingModel）
 *   matchBM25(q, t)      → BM25 归一化 ∈ [0,1]（基于持久 corpus）
 *   matchSubstring(q, t) → 子串精确匹配 ∈ {0,1}（query ≥ 2 字符才启用）
 *   match(q, t)          → 三路加权融合（默认 0.5 / 0.3 / 0.2）
 *   search(q, items, toText) → 批量 top-k
 *
 * cachePath 必传：searcher.sqlite 落到此目录下。
 * embeddingModel 不传 → matchEmbedding 永远 0，融合时权重让给另外两路。
 * 长自然句查询 → matchSubstring 几乎恒 0（整句 includes 不命中），分数整体
 * 偏低属预期，排序不受影响；被 minScore 误杀时优先调阈值而非权重。
 *
 * 文件布局：`<cachePath>/searcher.sqlite`
 *   embeddings(key TEXT PK = 原文, embedding BLOB, created_at)
 *   docs(rowid, key UNIQUE = 原文, text = 索引文本) + docs_fts(text)
 *
 * docs / embeddings 都用原文本身当 key —— 同一段 text 在不同语境共享一行，
 * embedding 只算一次，FTS5 行只插一次。docs.text 是索引文本（CJK 逐字拆开，
 * 见 indexText），与 key（原文）不同；映射回 item 一律走 key。
 *
 * CJK 检索：unicode61 会把连续汉字粘成一个 token，中文查询基本无法命中。
 * 因此入库时把 CJK 逐字拆开（空格分隔），查询时把 CJK 串转成相邻二字
 * bigram phrase（OR 连接）—— 相当于对 CJK 做子串召回，且按"命中几个
 * bigram / 多稀有"排序。
 */
export interface HybridSearcherOptions {
    /** 持久化目录。searcher.sqlite 落到此目录下。 */
    cachePath: string;
    embeddingModel?: IEmbeddingService;
    embeddingWeight?: number;
    bm25Weight?: number;
    substringWeight?: number;
    /** search() 命中分数阈值，默认 0.15（≈ embedding cos ≥ 0.25 或有效 BM25 命中）。 */
    minScore?: number;
}

const DEFAULT_EMB_W = 0.5;
const DEFAULT_BM25_W = 0.3;
const DEFAULT_SUB_W = 0.2;
const DEFAULT_MIN_SCORE = 0.15;

/** BM25 raw → [0,1] 归一化。raw bm25 ∈ ~[-3(小 corpus) ~ -20(大 corpus), 0]，越负越好。 */
const BM25_NORM_SCALE = 3;

export class HybridSearcher {
    private readonly embeddingModel?: IEmbeddingService;
    private readonly db: Database.Database;
    /** 内存层 embedding 缓存，key = 原文。SQLite 命中后回填这里。 */
    private readonly memCache = new Map<string, number[]>();
    private readonly w: { emb: number; bm25: number; sub: number };
    private readonly minScore: number;
    private disposed = false;

    constructor(options: HybridSearcherOptions) {
        this.embeddingModel = options.embeddingModel;
        this.w = {
            emb: options.embeddingWeight ?? DEFAULT_EMB_W,
            bm25: options.bm25Weight     ?? DEFAULT_BM25_W,
            sub:  options.substringWeight ?? DEFAULT_SUB_W,
        };
        this.minScore = options.minScore ?? DEFAULT_MIN_SCORE;

        if (!existsSync(options.cachePath)) mkdirSync(options.cachePath, { recursive: true });
        this.db = new Database(path.join(options.cachePath, "searcher.sqlite"));
        this.db.pragma("journal_mode = WAL");
        this.initSchema();
    }

    // ── 评分原语 ────────────────────────────────────────────────────────

    /**
     * Embedding cosine 相似度，映射到 [0,1]：max(cos, 0)。
     * 不用 (cos+1)/2 —— 文本 embedding 的 cosine 实际落在 [0,1]，(cos+1)/2
     * 会把不相关内容也抬到 ~0.5，让 minScore 失去过滤意义。
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
            return Math.max(cosineSimilarity(qVec, tVec, vectorNorm(qVec)), 0);
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
     * 综合评分：三路原语加权融合。
     * 未启用的路（无 embeddingModel / query < 2 字符时子串路）权重让位给其余路。
     */
    async match(query: string, text: string): Promise<number> {
        const [emb, bm25] = await Promise.all([
            this.matchEmbedding(query, text),
            this.matchBM25(query, text),
        ]);
        return this.fuse(query, emb, bm25, this.matchSubstring(query, text));
    }

    /**
     * 子串精确匹配，∈ {0, 1}。
     *
     * - 纯拉丁词 → 词边界匹配：`othello` 不会命中 `hello`；
     * - 其他（含 CJK / 混合）→ 大小写折叠后 `includes`；
     * - query 不足 2 字符 → 0（单字命中太宽），融合时该路权重让位给其余路。
     *
     * 无 IO 无模型调用，O(len(text))。
     */
    matchSubstring(query: string, text: string): number {
        if (!query || !text) return 0;
        const q = query.trim();
        if (q.length < 2) return 0;
        if (/^[A-Za-z0-9_]+$/.test(q)) {
            // 纯 ASCII 词不含正则元字符，可安全内插；注意不能用 \p{L}——
            // 它包含汉字，会把中文 query 误判成「纯词」走 \b 词边界，
            // 而 JS 的 \b 是 ASCII 词边界，中文两侧永远匹配不上
            return new RegExp(`\\b${q}\\b`, "i").test(text) ? 1 : 0;
        }
        return text.toLowerCase().includes(q.toLowerCase()) ? 1 : 0;
    }

    /** 三路加权融合：未启用的路权重让位（权重和归一），子串路按 query 长度启用。 */
    private fuse(query: string, emb: number, bm25: number, sub: number): number {
        const useEmb = !!this.embeddingModel;
        const useSub = query.trim().length >= 2;
        const wEmb = useEmb ? this.w.emb : 0;
        const wSub = useSub ? this.w.sub : 0;
        const tw = wEmb + this.w.bm25 + wSub;
        if (tw === 0) return 0;
        return (wEmb * emb + this.w.bm25 * bm25 + wSub * sub) / tw;
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
     * 2. 一次 FTS5 query 拿 bm25 + snippet
     * 3. 所有 item 都算 embedding 分（不做 BM25 候选门控 —— 门控会把
     *    换说法/同义的纯语义命中挡在门外；调用方规模小，全量算可承受）
     *    + 子串精确分（matchSubstring）
     * 4. 加权融合 → 过滤 minScore → 排序 → 截断
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

        const useEmb = !!this.embeddingModel;

        const tasks = items.map(async (item, i) => {
            const text = texts[i];
            if (!text) return null;
            const bm25 = bm25ByText.get(text) ?? 0;
            const emb = useEmb ? await this.matchEmbedding(query, text) : 0;
            const sub = this.matchSubstring(query, text);
            return {
                item,
                score: this.fuse(query, emb, bm25, sub),
                snippet: snippetByText.get(text),
            };
        });
        const results = (await Promise.all(tasks))
            .filter((r): r is NonNullable<typeof r> => r !== null);

        return results
            .filter(r => r.score > this.minScore)
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
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

        const rows = this.db.prepare(`
            SELECT d.key                                       AS key,
                   bm25(docs_fts)                              AS score,
                   snippet(docs_fts, 0, '<<', '>>', '...', 32) AS snippet
            FROM docs_fts JOIN docs d ON d.rowid = docs_fts.rowid
            WHERE docs_fts MATCH @fts
            ORDER BY score
            LIMIT @limit
        `).all({ fts, limit: limit * 3 }) as Array<{ key: string; score: number; snippet: string }>;
        for (const r of rows) {
            bm25ByText.set(r.key, normalizeBm25(r.score));
            // 索引文本里 CJK 被空格拆开，snippet 展示前拼回去
            snippetByText.set(r.key, despaceCjk(r.snippet));
        }
        return { bm25ByText, snippetByText };
    }

    private upsertDoc(text: string): void {
        this.db.prepare(`
            INSERT INTO docs (key, text) VALUES (?, ?)
            ON CONFLICT(key) DO NOTHING
        `).run(text, indexText(text));
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
            for (const t of seen) upsert.run(t, indexText(t));
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
        // v1：docs.text 从「原文」改为「CJK 逐字拆开的索引文本」。
        // 旧行的 FTS 内容是未拆分形式，ON CONFLICT DO NOTHING 不会重写，
        // 直接重建 docs/docs_fts（embedding 缓存按原文 key，无需动）。
        const version = this.db.pragma("user_version", { simple: true }) as number;
        if (version < 1) {
            this.db.exec(`
                DROP TRIGGER IF EXISTS docs_ai;
                DROP TRIGGER IF EXISTS docs_ad;
                DROP TRIGGER IF EXISTS docs_au;
                DROP TABLE IF EXISTS docs_fts;
                DROP TABLE IF EXISTS docs;
            `);
        }
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
        this.db.pragma(`user_version = 1`);
    }
}

// ── 辅助 ──

/**
 * 自由文本 → FTS5 MATCH 表达式。
 *
 * - FTS5 MATCH 语法对 `"`、`(`、`*`、`:` 等特殊字符敏感，原始用户字符串直接喂会崩 parser。
 *   每个 token phrase-quote 后再 OR-join，绕过所有特殊字符问题。
 * - 用 OR 而非 AND：长查询里只要一个词没存就归零；OR 让 BM25 按"命中几个 / 多稀有"排序。
 * - 拉丁/数字 token 原样 phrase；CJK 串转成相邻二字 bigram phrase —— unicode61 会把
 *   连续汉字粘成一个 token，bigram 是内建 tokenizer 下唯一能做 CJK 子串召回的办法
 *   （trigram 对 1-2 字查询无效，中文查询恰恰多是 2 字）。
 *
 * 返回 null 表示提不出有效 token，调用方应直接当"空查询，0 结果"，不要喂给 SQL。
 */
function buildFtsQuery(raw: string): string | null {
    // 拉丁/数字 token：把 CJK 段挖掉后按 \p{L}\p{N}_ 提取
    const latin =
        raw.replace(CJK_RUN_RE, " ").match(/[\p{L}\p{N}_]+/gu) ?? [];

    // CJK 串 → 相邻二字 bigram phrase："混合检索" → "混 合" OR "合 检" OR "检 索"
    const phrases: string[] = latin.map(t => `"${t.replaceAll('"', "")}"`);
    for (const run of raw.match(CJK_RUN_RE) ?? []) {
        const chars = [...run];
        for (let i = 0; i < chars.length - 1; i++) {
            phrases.push(`"${chars[i]} ${chars[i + 1]}"`);
        }
    }
    if (phrases.length === 0) return null;
    return phrases.join(" OR ");
}

/**
 * CJK 范围：汉字（含扩展 A / 兼容区）+ 假名。这些文字在 unicode61 下
 * 连续出现会粘成一个 token，需要逐字拆开索引。
 */
const CJK_RUN_RE = /[぀-ヿ㐀-䶿一-鿿豈-﫿]+/gu;

/** 原文 → 索引文本：CJK 逐字拆开（空格分隔），其余原样。 */
function indexText(text: string): string {
    return text.replace(CJK_RUN_RE, run => [...run].join(" "));
}

/** 索引文本（或其 snippet）→ 可读文本：去掉相邻 CJK 字间的空格。 */
function despaceCjk(s: string): string {
    if (!s.includes("<<")) {
        return s.replace(CJK_GAP_RE, "$1");
    }
    // snippet 高亮标记 << >> 视为透明：混 <<合>> 检 索 → 混<<合>>检 索
    const L = "\u0001", R = "\u0002";
    return s.replaceAll("<<", L).replaceAll(">>", R)
        .replace(/([\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])\s+(?=\u0001[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])/gu, "$1") // 汉 <<汉
        .replace(/([\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])\u0002\s+(?=[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])/gu, "$1\u0002") // 汉>> 汉
        .replace(CJK_GAP_RE, "$1") // 汉 汉
        .replaceAll(L, "<<").replaceAll(R, ">>");
}

/** 「CJK 字 + 空白 + CJK 字」的空隙（despace 用）。 */
const CJK_GAP_RE = /([\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])\s+(?=[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff])/gu;

function vectorNorm(v: number[]): number {
    let s = 0;
    for (const x of v) s += x * x;
    return Math.sqrt(s);
}

/**
 * 计算两个向量的余弦相似度，返回 [-1, 1]。
 * @param precomputedNormA 预计算的向量 a 的模长（批量比较时可避免重复计算）
 */
function cosineSimilarity(a: number[], b: number[], precomputedNormA?: number): number {
    let dotProduct = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dotProduct += a[i] * b[i];
        normB += b[i] * b[i];
    }

    let normA = precomputedNormA;
    if (normA === undefined) {
        normA = 0;
        for (let i = 0; i < a.length; i++) normA += a[i] * a[i];
        normA = Math.sqrt(normA);
    }

    const denominator = normA * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
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
