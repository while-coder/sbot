import path from "path";
import { mkdirSync } from "fs";
import Database from "better-sqlite3";

const BM25_WEIGHT = 0.3;
const SUBSTRING_WEIGHT = 0.2;
const MIN_SCORE = 0.15;

/** BM25 raw → [0,1] 归一化。raw bm25 ∈ ~[-3(小 corpus) ~ -20(大 corpus), 0]，越负越好。 */
const BM25_NORM_SCALE = 3;

export class MemorySearchIndex {
    private readonly db: Database.Database;
    private disposed = false;

    constructor(cachePath: string) {
        mkdirSync(cachePath, { recursive: true });
        this.db = new Database(path.join(cachePath, "searcher.sqlite"));
        this.db.pragma("journal_mode = WAL");
        this.initSchema();
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
    private matchSubstring(query: string, text: string): number {
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

    search<T>(
        query: string,
        items: T[],
        toText: (item: T) => string,
        limit: number,
    ): { item: T; score: number; snippet?: string }[] {
        if (items.length === 0) return [];

        const texts = items.map(toText);
        const uniqueTexts = [...new Set(texts.filter(Boolean))];
        if (uniqueTexts.length === 0) return [];

        this.syncCorpus(uniqueTexts);

        const { bm25ByText, snippetByText } = this.ftsBatch(query, limit);

        const substringWeight = query.trim().length >= 2 ? SUBSTRING_WEIGHT : 0;
        const totalWeight = BM25_WEIGHT + substringWeight;
        return items.flatMap((item, i) => {
            const text = texts[i];
            if (!text) return [];
            const bm25 = bm25ByText.get(text) ?? 0;
            const substring = this.matchSubstring(query, text);
            const score = (BM25_WEIGHT * bm25 + substringWeight * substring) / totalWeight;
            return score > MIN_SCORE ? [{ item, score, snippet: snippetByText.get(text) }] : [];
        }).sort((a, b) => b.score - a.score).slice(0, limit);
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

    private initSchema(): void {
        // v1：docs.text 从「原文」改为「CJK 逐字拆开的索引文本」。
        // 旧行的 FTS 内容是未拆分形式，ON CONFLICT DO NOTHING 不会重写，
        // 直接重建 docs/docs_fts。
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

/** raw bm25 (lower=better, ~[-20, 0]) → [0, 1] (higher=better) */
function normalizeBm25(raw: number): number {
    if (raw >= 0) return 0;
    return 1 - Math.exp(raw / BM25_NORM_SCALE);
}
