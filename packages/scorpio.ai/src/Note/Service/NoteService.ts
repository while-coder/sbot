import { v4 as uuidv4 } from "uuid";
import { inject, T_NoteSystemPromptTemplate, T_NoteToolDescs, T_NoteCachePath } from "../../Core";
import { TimeUtils } from "../../Utils/TimeUtils";
import { NoteResult } from "../types";
import { INoteDatabase } from "../Storage/INoteDatabase";
import { Note } from "../types";
import { INoteService } from "./INoteService";
import { IEmbeddingService } from "../../Embedding";
import { ILoggerService, ILogger } from "../../Logger";
import { CharacterTextSplitter } from "@langchain/textsplitters";
import { NoteToolDescs } from "../Tools/NoteToolProvider";
import { HybridSearcher } from "../../Retrieval";

const DUPLICATE_THRESHOLD = 0.85;
const TIME_DECAY_FACTOR = 0.995;

/**
 * Note 检索 + 写入。
 *
 * 检索分两层：
 *   1. HybridSearcher 给基础分（embedding cosine + BM25，带 query / text 缓存）
 *   2. 本服务再叠加 time decay + access count 加权
 *
 * embedding 可选：没配 IEmbeddingService 时退化为 BM25 关键词检索 + decay/access。
 * 去重逻辑只在 embedding 存在时启用（cosine ≥ 0.85），无 model 时直接写入不去重。
 */
export class NoteService implements INoteService {
  private logger?: ILogger;
  private readonly searcher: HybridSearcher;

  constructor(
    @inject(INoteDatabase) private db: INoteDatabase,
    @inject(T_NoteCachePath) cachePath: string,
    @inject(T_NoteSystemPromptTemplate) private systemPromptTemplate: string,
    @inject(T_NoteToolDescs) private toolDescs: NoteToolDescs,
    @inject(IEmbeddingService, { optional: true }) private embeddings?: IEmbeddingService,
    @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
  ) {
    this.logger = loggerService?.getLogger("NoteService");
    this.searcher = new HybridSearcher({
      cachePath,
      embeddingModel: embeddings,
    });
  }

  getToolDescs(): NoteToolDescs {
    return this.toolDescs;
  }

  async getSystemMessage(query: string): Promise<string | null> {
    const noteLimit = 10;
    const results = await this.getNotes(query, noteLimit);
    if (results.length === 0) return null;
    const items = results
      .map(({ note: n }) => `  <note time="${TimeUtils.formatTimeAgo(n.createdAt)}">${n.content}</note>`)
      .join("\n");
    return this.systemPromptTemplate.replace('{items}', items);
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async getNotes(query: string, limit: number = 10): Promise<NoteResult[]> {
    try {
      const all = await this.db.getAllNotes();
      if (all.length === 0) return [];

      // 第 1 层：HybridSearcher 基础分（embedding + BM25）
      const base = await this.searcher.search(
        query,
        all,
        (n) => n.content,
        limit * 2,
      );
      if (base.length === 0) return [];

      // 第 2 层：time decay + access count 加权
      const now = Date.now();
      const ranked = base
        .map(({ item: n, score }) => {
          const hours = (now - n.createdAt) / 3600000;
          const timeDecay    = Math.pow(TIME_DECAY_FACTOR, hours);
          const recencyScore = Math.pow(0.5, hours / 24);
          const accessScore  = Math.log(n.accessCount + 1) / 10;
          const finalScore = score * timeDecay * 0.7
                           + recencyScore * 0.2
                           + accessScore * 0.1;
          return { note: n, score: finalScore };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      // 命中刷新 access
      for (const r of ranked) {
        await this.db.updateAccess(r.note.id);
      }
      return ranked;
    } catch (error: any) {
      this.logger?.warn(`Failed to retrieve notes: ${error.message}`);
      return [];
    }
  }

  async getAllNotes(): Promise<Note[]> {
    return this.db.getAllNotes();
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  async addNoteDirect(content: string, options?: { autoSplit?: boolean; chunkSize?: number }): Promise<string[]> {
    const shouldSplit = options?.autoSplit !== false;
    const chunkSize = options?.chunkSize && options.chunkSize > 0 ? options.chunkSize : 500;
    const chunkOverlap = Math.min(50, Math.floor(chunkSize / 10));
    const chunks = shouldSplit
      ? await new CharacterTextSplitter({ chunkSize, chunkOverlap }).splitText(content)
      : [content];

    const ids: string[] = [];
    for (const chunk of chunks) {
      ids.push(await this.addOne(chunk));
    }
    return ids;
  }

  async updateNoteDirect(noteId: string, content: string): Promise<void> {
    const trimmed = content.trim();
    if (!trimmed) throw new Error("content is required");
    await this.db.updateNoteContent(noteId, trimmed);
    // embedding 缓存按文本本身 key，老 content 的向量留在 searcher.sqlite 里不影响正确性。
    // 新 content 首次检索时会被 lazy embed。
  }

  // ── Maintenance ────────────────────────────────────────────────────────────

  async deleteNote(noteId: string): Promise<void> {
    await this.db.deleteNote(noteId);
  }

  async clearAll(): Promise<number> {
    const count = await this.db.clearNotes();
    this.logger?.info(`Cleared ${count} notes`);
    return count;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    this.searcher.dispose();
    await this.db.dispose();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async addOne(content: string): Promise<string> {
    // 有 embedding → 跑一次去重检测（同 content + cosine ≥ 0.85）；无 model 时直接写入
    if (this.embeddings) {
      const all = await this.db.getAllNotes();
      for (const existing of all) {
        if (existing.content !== content) continue;
        const sim = await this.searcher.matchEmbedding(content, existing.content);
        if (sim >= DUPLICATE_THRESHOLD) {
          await this.db.updateAccess(existing.id);
          return existing.id;
        }
      }
    }

    const note: Note = {
      id: uuidv4(),
      content,
      createdAt: Date.now(),
      accessCount: 0,
      lastAccessed: Date.now(),
    };
    await this.db.insertNote(note);
    return note.id;
  }
}
