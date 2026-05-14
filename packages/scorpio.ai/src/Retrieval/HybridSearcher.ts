import { IEmbeddingService } from "../Embedding";
import { cosineSimilarity } from "../Memory/utils";
import fs from "fs";

export interface SearchableItem {
    key: string;
    text: string;
}

export interface HybridSearchOptions {
    cachePath: string;
    keywordWeight?: number;
    jaccardWeight?: number;
    embeddingWeight?: number;
    minScore?: number;
}

interface CacheEntry {
    text: string;
    vector: number[];
}

type EmbeddingCache = Record<string, CacheEntry>;

const DEFAULT_KEYWORD_WEIGHT = 0.4;
const DEFAULT_JACCARD_WEIGHT = 0.3;
const DEFAULT_EMBEDDING_WEIGHT = 0.3;
const DEFAULT_KEYWORD_WEIGHT_FALLBACK = 0.6;
const DEFAULT_JACCARD_WEIGHT_FALLBACK = 0.4;
const DEFAULT_MIN_SCORE = 0.05;

export class HybridSearcher {
    private keywordWeight: number;
    private jaccardWeight: number;
    private embeddingWeight: number;
    private minScore: number;
    private cachePath: string;
    private _isReady = false;

    constructor(options: HybridSearchOptions) {
        this.cachePath = options.cachePath;
        this.keywordWeight = options.keywordWeight ?? DEFAULT_KEYWORD_WEIGHT;
        this.jaccardWeight = options.jaccardWeight ?? DEFAULT_JACCARD_WEIGHT;
        this.embeddingWeight = options.embeddingWeight ?? DEFAULT_EMBEDDING_WEIGHT;
        this.minScore = options.minScore ?? DEFAULT_MIN_SCORE;
    }

    get isReady(): boolean {
        return this._isReady;
    }

    // ── Index Management ──

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
        this._isReady = true;
    }

    async updateEntry(key: string, text: string, embeddings: IEmbeddingService): Promise<void> {
        const [vector] = await embeddings.embedDocuments([text]);
        const cache = this.loadCache();
        cache[key] = { text, vector };
        this.saveCache(cache);
    }

    removeEntry(key: string): void {
        const cache = this.loadCache();
        delete cache[key];
        this.saveCache(cache);
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
        const kw = hasEmb ? this.keywordWeight : DEFAULT_KEYWORD_WEIGHT_FALLBACK;
        const jw = hasEmb ? this.jaccardWeight : DEFAULT_JACCARD_WEIGHT_FALLBACK;
        const ew = hasEmb ? this.embeddingWeight : 0;

        const vectorIndex = hasEmb ? this.loadCache() : null;

        const scored = items.map(item => {
            const { key, text } = toSearchable(item);
            const descTokens = tokenize(text);

            const matchedTerms = [...queryTokens].filter(t => descTokens.has(t)).length;
            const keywordScore = matchedTerms / queryTokens.size;

            const union = new Set([...queryTokens, ...descTokens]).size;
            const jaccardScore = union === 0 ? 0 : matchedTerms / union;

            let embeddingScore = 0.5;
            if (hasEmb) {
                const vector = vectorIndex![key]?.vector;
                if (vector) {
                    embeddingScore = (cosineSimilarity(queryEmbedding!, vector, normQ) + 1) / 2;
                }
            }

            const relevance = kw * keywordScore + jw * jaccardScore + ew * embeddingScore;
            return { item, score: relevance };
        });

        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .filter(r => r.score > this.minScore)
            .map(r => r.item);
    }
}

function tokenize(text: string): Set<string> {
    return new Set(text.toLowerCase().split(/\s+/).filter(Boolean));
}
