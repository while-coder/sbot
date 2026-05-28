import { v4 as uuidv4 } from "uuid";
import { inject, T_MemorySystemPromptTemplate, T_MemoryToolDescs, formatTimeAgo } from "../../Core";
import { MemoryResult } from "../types";
import { IMemoryDatabase } from "../Storage/IMemoryDatabase";
import { Memory } from "../types";
import { IMemoryService } from "./IMemoryService";
import { IEmbeddingService } from "../../Embedding";
import { ILoggerService, ILogger } from "../../Logger";
import { CharacterTextSplitter } from "@langchain/textsplitters";
import { MemoryToolDescs } from "../Tools/MemoryToolProvider";

export class MemoryService implements IMemoryService {
  private logger?: ILogger;

  constructor(
    @inject(IMemoryDatabase) private db: IMemoryDatabase,
    @inject(IEmbeddingService) private embeddings: IEmbeddingService,
    @inject(T_MemorySystemPromptTemplate) private systemPromptTemplate: string,
    @inject(T_MemoryToolDescs) private toolDescs: MemoryToolDescs,
    @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
  ) {
    this.logger = loggerService?.getLogger("MemoryService");
  }

  getToolDescs(): MemoryToolDescs {
    return this.toolDescs;
  }

  async getSystemMessage(query: string): Promise<string | null> {
    const memoryLimit = 10;
    const results = await this.getMemories(query, memoryLimit);
    if (results.length === 0) return null;
    const items = results
      .map(({ memory: m }) => `  <memory time="${formatTimeAgo(m.createdAt)}">${m.content}</memory>`)
      .join("\n");
    return this.systemPromptTemplate.replace('{items}', items);
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  async getMemories(query: string, limit: number = 10): Promise<MemoryResult[]> {
    try {
      const queryEmbedding = await this.embeddings.embedQuery(query);
      const results = await this.db.searchWithTimeDecay(queryEmbedding, Date.now(), 0.995, limit);
      for (const result of results) {
        await this.db.updateAccess(result.memory.id);
      }
      return results;
    } catch (error: any) {
      this.logger?.warn(`Failed to retrieve memories: ${error.message}`);
      return [];
    }
  }

  async getAllMemories(): Promise<Memory[]> {
    return this.db.getAllMemories();
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  async addMemoryDirect(content: string, options?: { autoSplit?: boolean; chunkSize?: number }): Promise<string[]> {
    const shouldSplit = options?.autoSplit !== false;
    const chunkSize = options?.chunkSize && options.chunkSize > 0 ? options.chunkSize : 500;
    const chunkOverlap = Math.min(50, Math.floor(chunkSize / 10));
    const chunks = shouldSplit
      ? await new CharacterTextSplitter({ chunkSize, chunkOverlap }).splitText(content)
      : [content];
    const embeddings = await this.embeddings.embedDocuments(chunks);
    const ids: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      ids.push(await this.addMemory(chunks[i], embeddings[i]));
    }
    return ids;
  }

  async updateMemoryDirect(memoryId: string, content: string): Promise<void> {
    const trimmed = content.trim();
    if (!trimmed) throw new Error("content is required");
    const [embedding] = await this.embeddings.embedDocuments([trimmed]);
    await this.db.updateMemory(memoryId, trimmed, embedding);
  }

  // ── Maintenance ────────────────────────────────────────────────────────────

  async deleteMemory(memoryId: string): Promise<void> {
    await this.db.deleteMemory(memoryId);
  }

  async clearAll(): Promise<number> {
    const count = await this.db.clearMemories();
    this.logger?.info(`Cleared ${count} memories`);
    return count;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async dispose(): Promise<void> {
    await this.db.dispose();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async addMemory(
    content: string,
    embedding: number[]
  ): Promise<string> {
    const duplicate = await this.db.findDuplicate(embedding, 0.85);
    if (duplicate && duplicate.memory.content === content) {
      await this.db.updateAccess(duplicate.memory.id);
      return duplicate.memory.id;
    }

    const memory: Memory = {
      id: uuidv4(),
      content,
      embedding,
      createdAt: Date.now(),
      accessCount: 0,
      lastAccessed: Date.now(),
    };

    await this.db.insertMemory(memory);
    return memory.id;
  }
}
