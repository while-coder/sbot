import { v4 as uuidv4 } from "uuid";
import { inject, init, T_MaxMemoryAgeDays, T_MemoryMode, T_MemorySystemPromptTemplate } from "../../Core";
import { IMemoryDatabase } from "../Storage/IMemoryDatabase";
import { Memory, MemoryMode } from "../types";
import { IMemoryService } from "./IMemoryService";
import { IEmbeddingService } from "../../Embedding";
import { ILoggerService, ILogger } from "../../Logger";
import { IMemoryCompressor } from "../Compressor/IMemoryCompressor";
import { IMemoryEvaluator } from "../Evaluator/IMemoryEvaluator";
import { IMemoryExtractor } from "../Extractor/IMemoryExtractor";
import { CharacterTextSplitter } from "@langchain/textsplitters";

export class MemoryService implements IMemoryService {
  private maxMemoryAgeDays: number;
  private memoryMode: MemoryMode;
  private logger?: ILogger;

  constructor(
    @inject(IMemoryDatabase) private db: IMemoryDatabase,
    @inject(IEmbeddingService) private embeddings: IEmbeddingService,
    @inject(IMemoryEvaluator) private evaluator: IMemoryEvaluator,
    @inject(IMemoryExtractor) private extractor: IMemoryExtractor,
    @inject(T_MemorySystemPromptTemplate) private systemPromptTemplate: string,
    @inject(T_MaxMemoryAgeDays, { optional: true }) maxMemoryAgeDays?: number,
    @inject(T_MemoryMode, { optional: true }) memoryMode?: MemoryMode,
    @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
    @inject(IMemoryCompressor, { optional: true }) private compressor?: IMemoryCompressor,
  ) {
    this.logger = loggerService?.getLogger("MemoryService");
    this.maxMemoryAgeDays = maxMemoryAgeDays || 90;
    this.memoryMode = memoryMode || MemoryMode.HUMAN_ONLY;
  }

  @init()
  async init(): Promise<void> {
    this.cleanupOldMemories().catch(err => {
      this.logger?.error(`Auto memory cleanup failed: ${err.message}`);
    });
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  /**
   * Build a memory system message for the given query.
   * Retrieves relevant memories; returns null if none found.
   */
  async getSystemMessage(query: string, limit: number = 10): Promise<string | null> {
    try {
      const memories = await this.retrieveRelevantMemories(query, limit);
      if (memories.length === 0) return null;

      const items = memories
        .map(m => `  <memory time="${this.formatTimeAgo(m.metadata.timestamp)}">${m.content}</memory>`)
        .join("\n");
      return this.systemPromptTemplate.replace('{items}', items);
    } catch (error: any) {
      this.logger?.warn(`Failed to build memory system message: ${error.message}`);
      return null;
    }
  }

  async getAllMemories(): Promise<Memory[]> {
    return this.db.getAllMemories();
  }

  // ── Write ──────────────────────────────────────────────────────────────────

  /**
   * Memorize a conversation turn.
   * Uses the extractor to distill knowledge points when available.
   */
  async memorizeConversation(
    userMessage: string,
    assistantMessage?: string[],
  ): Promise<void> {
    if (this.memoryMode === MemoryMode.READ_ONLY) return;

    const includeAI = this.memoryMode === MemoryMode.HUMAN_AND_AI;

    const facts = includeAI
      ? await this.extractor.extract(userMessage, assistantMessage)
      : await this.extractor.extract(userMessage);
    if (facts.length === 0) return;
    const embeddings = await this.embeddings.embedDocuments(facts.map(f => f.content));
    for (let i = 0; i < facts.length; i++) {
      await this.addMemory(facts[i].content, facts[i].importance, embeddings[i]);
    }
  }

  async addMemoryDirect(content: string): Promise<string[]> {
    const chunks = await new CharacterTextSplitter({ chunkSize: 500, chunkOverlap: 50 }).splitText(content);
    const [evaluations, embeddings] = await Promise.all([
      Promise.all(chunks.map(chunk => this.evaluator.evaluate(chunk))),
      this.embeddings.embedDocuments(chunks),
    ]);
    const ids: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      ids.push(await this.addMemory(chunks[i], evaluations[i].importance, embeddings[i]));
    }
    return ids;
  }

  // ── Maintenance ────────────────────────────────────────────────────────────

  async deleteMemory(memoryId: string): Promise<void> {
    await this.db.deleteMemory(memoryId);
  }

  /**
   * Compress similar memories
   * @returns Number of compressed groups
   */
  async compressMemories(): Promise<number> {
    if (!this.compressor) {
      this.logger?.warn("MemoryCompressor not enabled, skipping compression");
      return 0;
    }

    try {
      const allMemories = await this.db.getAllMemories();
      if (allMemories.length < 2) return 0;

      const groups = this.compressor.findCompressibleGroups(allMemories);
      let compressedCount = 0;

      for (const group of groups) {
        const result = await this.compressor.compress(
          group,
          (text) => this.embeddings.embedQuery(text)
        );
        if (result) {
          await this.db.insertMemory(result.compressedMemory);
          for (const id of result.sourceMemoryIds) {
            await this.db.deleteMemory(id);
          }
          compressedCount++;
          this.logger?.info(`Compressed memory group: ${result.summary}`);
        }
      }

      return compressedCount;
    } catch (error: any) {
      this.logger?.error(`Memory compression failed: ${error.message}`);
      return 0;
    }
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
    importance: number,
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
      metadata: {
        timestamp: Date.now(),
        importance,
        accessCount: 0,
        lastAccessed: Date.now(),
      }
    };

    await this.db.insertMemory(memory);
    return memory.id;
  }

  private async retrieveRelevantMemories(query: string, limit: number = 5): Promise<Memory[]> {
    try {
      const queryEmbedding = await this.embeddings.embedQuery(query);
      const results = await this.db.searchWithTimeDecay(queryEmbedding, Date.now(), 0.995, limit * 2);

      for (const result of results) {
        await this.db.updateAccess(result.memory.id);
      }

      return this.rerankMemories(results.map(r => r.memory)).slice(0, limit);
    } catch (error: any) {
      this.logger?.error(`Memory retrieval failed: ${error.message}`);
      return [];
    }
  }

  private rerankMemories(memories: Memory[]): Memory[] {
    const now = Date.now();
    return memories
      .map(memory => {
        const hoursSinceCreation = (now - memory.metadata.timestamp) / 3600000;
        const recencyScore = Math.pow(0.5, hoursSinceCreation / 24);
        const accessScore = Math.log(memory.metadata.accessCount + 1) / 10;
        const score = recencyScore * 0.3 + memory.metadata.importance * 0.4 + accessScore * 0.3;
        return { memory, score };
      })
      .sort((a, b) => b.score - a.score)
      .map(item => item.memory);
  }

  private async cleanupOldMemories(): Promise<void> {
    const maxAgeMs = this.maxMemoryAgeDays * 24 * 3600 * 1000;
    const deletedCount = await this.db.pruneMemories(maxAgeMs, 0.3, 2);
    if (deletedCount > 0)
      this.logger?.info(`Pruned ${deletedCount} expired memories (older than ${this.maxMemoryAgeDays} days)`);
  }

  private formatTimeAgo(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return "just now";
  }
}
