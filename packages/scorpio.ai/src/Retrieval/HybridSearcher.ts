import { IEmbeddingService } from "../Embedding";
import { cosineSimilarity } from "../Memory/utils";
import fs from "fs";

export interface SearchableItem {
    key: string;
    text: string;
}

export interface HybridSearchOptions {
    cachePath: string;
    bm25Weight?: number;
    jaccardWeight?: number;
    embeddingWeight?: number;
    minScore?: number;
}

interface CacheEntry {
    text: string;
    vector: number[];
}

type EmbeddingCache = Record<string, CacheEntry>;

const DEFAULT_BM25_WEIGHT = 0.4;
const DEFAULT_JACCARD_WEIGHT = 0.3;
const DEFAULT_EMBEDDING_WEIGHT = 0.3;
const DEFAULT_BM25_WEIGHT_FALLBACK = 0.6;
const DEFAULT_JACCARD_WEIGHT_FALLBACK = 0.4;
const DEFAULT_MIN_SCORE = 0.05;

const BM25_K1 = 1.2;
const BM25_B = 0.75;

export class HybridSearcher {
    private bm25Weight: number;
    private jaccardWeight: number;
    private embeddingWeight: number;
    private minScore: number;
    private cachePath: string;
    private _isReady = false;
    private invertedIndex = new Map<string, Map<string, number>>();
    private docLengths = new Map<string, number>();
    private avgDocLength = 0;
    private totalDocs = 0;

    constructor(options: HybridSearchOptions) {
        this.cachePath = options.cachePath;
        this.bm25Weight = options.bm25Weight ?? DEFAULT_BM25_WEIGHT;
        this.jaccardWeight = options.jaccardWeight ?? DEFAULT_JACCARD_WEIGHT;
        this.embeddingWeight = options.embeddingWeight ?? DEFAULT_EMBEDDING_WEIGHT;
        this.minScore = options.minScore ?? DEFAULT_MIN_SCORE;
    }

    get isReady(): boolean {
        return this._isReady;
    }

    // ── Index Management ──

    buildIndexWithoutEmbeddings(items: SearchableItem[]): void {
        if (items.length === 0) { this._isReady = true; return; }
        this.buildInvertedIndex(items);
        this._isReady = true;
    }

    async buildIndex(items: SearchableItem[], embeddings: IEmbeddingService): Promise<void> {
        if (items.length === 0) { this._isReady = true; return; }

        const cache = this.loadCache();
        const toEmbed: { idx: number; text: string }[] = [];

        for (let i = 0; i < items.length; i++) {
            const { key, text } = items[i];
            const cached = cache[key];
            if (!cached || cached.text !== text) {
                toEmbed.push({ idx: i, text });
            }
        }

        if (toEmbed.length > 0) {
            const vectors = await embeddings.embedDocuments(toEmbed.map(e => e.text));
            for (let j = 0; j < toEmbed.length; j++) {
                const key = items[toEmbed[j].idx].key;
                cache[key] = { text: toEmbed[j].text, vector: vectors[j] };
            }
        }

        const validKeys = new Set(items.map(i => i.key));
        for (const k of Object.keys(cache)) {
            if (!validKeys.has(k)) delete cache[k];
        }

        this.saveCache(cache);
        this.buildInvertedIndex(items);
        this._isReady = true;
    }

    private buildInvertedIndex(items: SearchableItem[]): void {
        this.invertedIndex.clear();
        this.docLengths.clear();
        this.totalDocs = items.length;

        let totalLength = 0;
        for (const { key, text } of items) {
            const termFreq = tokenizeWithFreq(text);
            const docLen = [...termFreq.values()].reduce((a, b) => a + b, 0);
            this.docLengths.set(key, docLen);
            totalLength += docLen;

            for (const [term, freq] of termFreq) {
                if (!this.invertedIndex.has(term)) {
                    this.invertedIndex.set(term, new Map());
                }
                this.invertedIndex.get(term)!.set(key, freq);
            }
        }

        this.avgDocLength = totalLength / (this.totalDocs || 1);
    }

    async updateEntry(key: string, text: string, embeddings: IEmbeddingService): Promise<void> {
        const [vector] = await embeddings.embedDocuments([text]);
        const cache = this.loadCache();
        cache[key] = { text, vector };
        this.saveCache(cache);
        this.updateInvertedEntry(key, text);
    }

    removeEntry(key: string): void {
        const cache = this.loadCache();
        delete cache[key];
        this.saveCache(cache);
        this.removeInvertedEntry(key);
    }

    private updateInvertedEntry(key: string, text: string): void {
        this.removeInvertedEntry(key);
        const termFreq = tokenizeWithFreq(text);
        const docLen = [...termFreq.values()].reduce((a, b) => a + b, 0);
        this.docLengths.set(key, docLen);
        this.totalDocs = this.docLengths.size;
        this.avgDocLength = [...this.docLengths.values()].reduce((a, b) => a + b, 0) / (this.totalDocs || 1);

        for (const [term, freq] of termFreq) {
            if (!this.invertedIndex.has(term)) this.invertedIndex.set(term, new Map());
            this.invertedIndex.get(term)!.set(key, freq);
        }
    }

    private removeInvertedEntry(key: string): void {
        for (const [term, postings] of this.invertedIndex) {
            postings.delete(key);
            if (postings.size === 0) this.invertedIndex.delete(term);
        }
        this.docLengths.delete(key);
        this.totalDocs = this.docLengths.size;
        this.avgDocLength = this.totalDocs > 0
            ? [...this.docLengths.values()].reduce((a, b) => a + b, 0) / this.totalDocs
            : 0;
    }

    // ── Cache ──

    private loadCache(): EmbeddingCache {
        try {
            return JSON.parse(fs.readFileSync(this.cachePath, 'utf-8'));
        } catch {
            return {};
        }
    }

    private saveCache(cache: EmbeddingCache): void {
        fs.writeFileSync(this.cachePath, JSON.stringify(cache), 'utf-8');
    }

    // ── Search ──

    async search<T>(
        query: string,
        items: T[],
        toSearchable: (item: T) => SearchableItem,
        limit: number,
        embeddings?: IEmbeddingService,
    ): Promise<T[]> {
        const queryTokens = tokenize(query);
        if (queryTokens.size === 0) return items.slice(0, limit);

        let queryEmbedding: number[] | undefined;
        let normQ: number | undefined;
        if (embeddings && this._isReady) {
            try {
                queryEmbedding = await embeddings.embedQuery(query);
                normQ = 0;
                for (const v of queryEmbedding) normQ += v * v;
                normQ = Math.sqrt(normQ);
            } catch { /* embedding unavailable, fall through */ }
        }

        const hasEmb = queryEmbedding !== undefined;
        const bw = hasEmb ? this.bm25Weight : DEFAULT_BM25_WEIGHT_FALLBACK;
        const jw = hasEmb ? this.jaccardWeight : DEFAULT_JACCARD_WEIGHT_FALLBACK;
        const ew = hasEmb ? this.embeddingWeight : 0;

        const vectorIndex = hasEmb ? this.loadCache() : null;

        const scored = items.map(item => {
            const { key, text } = toSearchable(item);
            const descTokens = tokenize(text);

            const bm25Score = calcBM25Score(queryTokens, key, this.invertedIndex, this.docLengths, this.avgDocLength, this.totalDocs);
            const jaccardScore = calcJaccardScore(queryTokens, descTokens);
            const embeddingScore = hasEmb
                ? calcEmbeddingScore(queryEmbedding!, normQ!, vectorIndex![key]?.vector)
                : 0.5;

            const relevance = bw * bm25Score + jw * jaccardScore + ew * embeddingScore;
            return { item, score: relevance };
        });

        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .filter(r => r.score > this.minScore)
            .map(r => r.item);
    }
}

const STOP_WORDS = new Set([
    '的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
    '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
    '这', '那', '他', '她', '它', '们', '被', '把', '从', '对', '与', '为', '能',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'it', 'this', 'that', 'and', 'but', 'or', 'if', 'so',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as',
]);

const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });

function tokenize(text: string): Set<string> {
    const tokens = new Set<string>();
    for (const { segment, isWordLike } of segmenter.segment(text.toLowerCase())) {
        if (isWordLike && !STOP_WORDS.has(segment)) tokens.add(segment);
    }
    return tokens;
}

function tokenizeWithFreq(text: string): Map<string, number> {
    const freq = new Map<string, number>();
    for (const { segment, isWordLike } of segmenter.segment(text.toLowerCase())) {
        if (isWordLike && !STOP_WORDS.has(segment)) {
            freq.set(segment, (freq.get(segment) ?? 0) + 1);
        }
    }
    return freq;
}

function calcBM25Score(
    queryTokens: Set<string>,
    docKey: string,
    invertedIndex: Map<string, Map<string, number>>,
    docLengths: Map<string, number>,
    avgDocLength: number,
    totalDocs: number,
): number {
    const docLen = docLengths.get(docKey) ?? 0;
    if (docLen === 0) return 0;

    let score = 0;
    for (const term of queryTokens) {
        const postings = invertedIndex.get(term);
        if (!postings) continue;

        const tf = postings.get(docKey) ?? 0;
        if (tf === 0) continue;

        const df = postings.size;
        const idf = Math.log((totalDocs - df + 0.5) / (df + 0.5) + 1);
        const tfNorm = (tf * (BM25_K1 + 1)) / (tf + BM25_K1 * (1 - BM25_B + BM25_B * docLen / avgDocLength));
        score += idf * tfNorm;
    }

    const maxPossible = queryTokens.size * Math.log(totalDocs + 1) * (BM25_K1 + 1);
    return maxPossible > 0 ? Math.min(score / maxPossible, 1) : 0;
}

function calcJaccardScore(queryTokens: Set<string>, docTokens: Set<string>): number {
    const matchedTerms = [...queryTokens].filter(t => docTokens.has(t)).length;
    const union = new Set([...queryTokens, ...docTokens]).size;
    return union === 0 ? 0 : matchedTerms / union;
}

function calcEmbeddingScore(queryVector: number[], normQ: number, docVector?: number[]): number {
    if (!docVector) return 0.5;
    return (cosineSimilarity(queryVector, docVector, normQ) + 1) / 2;
}
