import { v4 as uuidv4 } from "uuid";
import { inject } from "../../Core";
import { MemoryResult } from "../types";
import { IMemoryDatabase } from "../Storage/IMemoryDatabase";
import { Memory } from "../types";
import { IMemoryService } from "./IMemoryService";
import { IEmbeddingService } from "../../Embedding";
import { ILoggerService, ILogger } from "../../Logger";
import { CharacterTextSplitter } from "@langchain/textsplitters";

export class MemoryService implements IMemoryService {
  private logger?: ILogger;

  constructor(
    @inject(IMemoryDatabase) private db: IMemoryDatabase,
    @inject(IEmbeddingService) private embeddings: IEmbeddingService,
    @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
  ) {
    this.logger = loggerService?.getLogger("MemoryService");
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

  async addMemoryDirect(content: string, options?: { autoSplit?: boolean }): Promise<string[]> {
    const shouldSplit = options?.autoSplit !== false;
    const chunks = shouldSplit
      ? await new CharacterTextSplitter({ chunkSize: 500, chunkOverlap: 50 }).splitText(content)
      : [content];
    const embeddings = await this.embeddings.embedDocuments(chunks);
    const ids: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      ids.push(await this.addMemory(chunks[i], embeddings[i]));
    }
    return ids;
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
