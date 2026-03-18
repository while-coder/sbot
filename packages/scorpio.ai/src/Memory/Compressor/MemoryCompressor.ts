import { z } from "zod";
import { HumanMessage } from "langchain";
import { IModelService } from "../../Model";
import { Memory } from "../types";
import { ILoggerService, ILogger } from "../../Logger";
import { inject } from "../../DI";
import { IMemoryCompressor, CompressionResult } from "./IMemoryCompressor";
import { T_CompressorPromptTemplate } from "../../Core";
import { cosineSimilarity } from "../utils";

const CompressionSchema = z.object({
  content: z.string().describe("The compressed memory content"),
});

/**
 * Memory compressor
 * Uses LLM to merge and compress similar or related memories
 */
export class MemoryCompressor implements IMemoryCompressor {
  private logger?: ILogger;

  constructor(
    @inject(IModelService) private modelService: IModelService,
    @inject(T_CompressorPromptTemplate) private promptTemplate: string,
    @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
  ) {
    this.logger = loggerService?.getLogger("MemoryCompressor");
  }

  /**
   * Compress multiple memories into one
   */
  async compress(
    memories: Memory[],
    generateEmbedding: (text: string) => Promise<number[]>
  ): Promise<CompressionResult | null> {
    if (memories.length < 2) {
      this.logger?.warn("At least 2 memories are required for compression");
      return null;
    }

    try {
      const compressedContent = await this.generateCompressedContent(memories);
      const newEmbedding = await generateEmbedding(compressedContent);

      let totalImportance = 0;
      let maxImportance = 0;
      let totalAccessCount = 0;
      let originalLength = 0;
      const originalTimestamps: number[] = [];

      for (const m of memories) {
        totalImportance += m.metadata.importance;
        if (m.metadata.importance > maxImportance) maxImportance = m.metadata.importance;
        totalAccessCount += m.metadata.accessCount;
        originalLength += m.content.length;
        originalTimestamps.push(m.metadata.timestamp);
      }

      const finalImportance = (totalImportance / memories.length + maxImportance) / 2;
      const now = Date.now();

      const compressedMemory: Memory = {
        id: `compressed_${now}_${Math.random().toString(36).substring(2, 11)}`,
        content: compressedContent,
        embedding: newEmbedding,
        metadata: {
          timestamp: now,
          importance: finalImportance,
          accessCount: totalAccessCount,
          lastAccessed: now,
          compressed: true,
          sourceCount: memories.length,
          originalTimestamps,
        }
      };
      const compressionRatio = compressedContent.length / originalLength;

      this.logger?.info(`Compressed ${memories.length} memories, ratio: ${(compressionRatio * 100).toFixed(1)}%`);

      return {
        compressedMemory,
        sourceMemoryIds: memories.map(m => m.id),
        compressionRatio,
        summary: `Merged ${memories.length} memories into 1, ratio ${(compressionRatio * 100).toFixed(1)}%`
      };
    } catch (error: any) {
      this.logger?.error(`Memory compression failed: ${error.message}`);
      return null;
    }
  }

  /**
   * Find groups of memories that can be compressed
   */
  findCompressibleGroups(
    memories: Memory[],
    similarityThreshold: number = 0.6
  ): Memory[][] {
    const groups: Memory[][] = [];
    const processed = new Set<string>();

    for (let i = 0; i < memories.length; i++) {
      if (processed.has(memories[i].id)) continue;

      const group: Memory[] = [memories[i]];
      processed.add(memories[i].id);

      for (let j = i + 1; j < memories.length; j++) {
        if (processed.has(memories[j].id)) continue;

        const similarity = cosineSimilarity(
          memories[i].embedding,
          memories[j].embedding
        );

        if (similarity >= similarityThreshold) {
          group.push(memories[j]);
          processed.add(memories[j].id);
        }
      }

      if (group.length >= 2) {
        groups.push(group);
      }
    }

    return groups;
  }

  // ===== Private =====

  private async generateCompressedContent(memories: Memory[]): Promise<string> {
    const memoriesText = memories.map((m, i) =>
      `<memory index="${i + 1}" time="${new Date(m.metadata.timestamp).toISOString()}">${m.content}</memory>`
    ).join('\n');
    const prompt = this.promptTemplate.replace('{memories}', memoriesText);
    const { content } = await this.modelService
      .withStructuredOutput<{ content: string }>(CompressionSchema)
      .invoke([new HumanMessage(prompt)]);
    return content;
  }

}
