import { v4 as uuidv4 } from "uuid";
import { inject, T_NoteSystemPromptTemplate, T_NoteToolDescs, formatTimeAgo } from "../../Core";
import { NoteResult } from "../types";
import { INoteDatabase } from "../Storage/INoteDatabase";
import { Note } from "../types";
import { INoteService } from "./INoteService";
import { IEmbeddingService } from "../../Embedding";
import { ILoggerService, ILogger } from "../../Logger";
import { CharacterTextSplitter } from "@langchain/textsplitters";
import { NoteToolDescs } from "../Tools/NoteToolProvider";

export class NoteService implements INoteService {
  private logger?: ILogger;

  constructor(
    @inject(INoteDatabase) private db: INoteDatabase,
    @inject(IEmbeddingService) private embeddings: IEmbeddingService,
    @inject(T_NoteSystemPromptTemplate) private systemPromptTemplate: string,
    @inject(T_NoteToolDescs) private toolDescs: NoteToolDescs,
    @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
  ) {
    this.logger = loggerService?.getLogger("NoteService");
  }

  getToolDescs(): NoteToolDescs {
    return this.toolDescs;
  }

  async getSystemMessage(query: string): Promise<string | null> {
    const noteLimit = 10;
    const results = await this.getNotes(query, noteLimit);
    if (results.length === 0) return null;
    const items = results
      .map(({ note: n }) => `  <note time="${formatTimeAgo(n.createdAt)}">${n.content}</note>`)
      .join("\n");
    return this.systemPromptTemplate.replace('{items}', items);
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async getNotes(query: string, limit: number = 10): Promise<NoteResult[]> {
    try {
      const queryEmbedding = await this.embeddings.embedQuery(query);
      const results = await this.db.searchWithTimeDecay(queryEmbedding, Date.now(), 0.995, limit);
      for (const result of results) {
        await this.db.updateAccess(result.note.id);
      }
      return results;
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
    const embeddings = await this.embeddings.embedDocuments(chunks);
    const ids: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      ids.push(await this.addNote(chunks[i], embeddings[i]));
    }
    return ids;
  }

  async updateNoteDirect(noteId: string, content: string): Promise<void> {
    const trimmed = content.trim();
    if (!trimmed) throw new Error("content is required");
    const [embedding] = await this.embeddings.embedDocuments([trimmed]);
    await this.db.updateNote(noteId, trimmed, embedding);
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
    await this.db.dispose();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async addNote(
    content: string,
    embedding: number[]
  ): Promise<string> {
    const duplicate = await this.db.findDuplicate(embedding, 0.85);
    if (duplicate && duplicate.note.content === content) {
      await this.db.updateAccess(duplicate.note.id);
      return duplicate.note.id;
    }

    const note: Note = {
      id: uuidv4(),
      content,
      embedding,
      createdAt: Date.now(),
      accessCount: 0,
      lastAccessed: Date.now(),
    };

    await this.db.insertNote(note);
    return note.id;
  }
}
