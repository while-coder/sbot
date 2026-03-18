import { z } from "zod";
import { HumanMessage } from "langchain";
import { IModelService } from "../../Model";
import { Memory } from "../types";
import { ILoggerService, ILogger } from "../../Logger";
import { inject } from "../../DI";
import { IMemoryCompressor, CompressionResult } from "./IMemoryCompressor";
import { T_CompressorPromptTemplate } from "../../Core";

const CompressionSchema = z.object({
  content: z.string().describe("The compressed memory content"),
});

/**
 * 记忆压缩器
 * 使用 LLM 合并和压缩相似或相关的记忆
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
   * 压缩多个记忆为一个
   */
  async compress(
    memories: Memory[],
    generateEmbedding: (text: string) => Promise<number[]>
  ): Promise<CompressionResult | null> {
    if (memories.length < 2) {
      this.logger?.warn("至少需要2条记忆才能压缩");
      return null;
    }

    try {
      const compressedContent = await this.generateCompressedContent(memories);
      const newEmbedding = await generateEmbedding(compressedContent);

      const avgImportance = memories.reduce((sum, m) => sum + m.metadata.importance, 0) / memories.length;
      const maxImportance = Math.max(...memories.map(m => m.metadata.importance));
      const finalImportance = (avgImportance + maxImportance) / 2;

      const compressedMemory: Memory = {
        id: `compressed_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
        content: compressedContent,
        embedding: newEmbedding,
        metadata: {
          timestamp: Date.now(),
          importance: finalImportance,
          accessCount: memories.reduce((sum, m) => sum + m.metadata.accessCount, 0),
          lastAccessed: Date.now(),
          compressed: true,
          sourceCount: memories.length,
          originalTimestamps: memories.map(m => m.metadata.timestamp),
        }
      };

      const originalLength = memories.reduce((sum, m) => sum + m.content.length, 0);
      const compressionRatio = compressedContent.length / originalLength;

      this.logger?.info(`成功压缩 ${memories.length} 条记忆，压缩比: ${(compressionRatio * 100).toFixed(1)}%`);

      return {
        compressedMemory,
        sourceMemoryIds: memories.map(m => m.id),
        compressionRatio,
        summary: `将 ${memories.length} 条记忆压缩为 1 条，压缩比 ${(compressionRatio * 100).toFixed(1)}%`
      };
    } catch (error: any) {
      this.logger?.error(`记忆压缩失败: ${error.message}`);
      return null;
    }
  }

  /**
   * 查找可以压缩的记忆组
   */
  findCompressibleGroups(
    memories: Memory[],
    similarityThreshold: number = 0.8
  ): Memory[][] {
    const groups: Memory[][] = [];
    const processed = new Set<string>();

    for (let i = 0; i < memories.length; i++) {
      if (processed.has(memories[i].id)) continue;

      const group: Memory[] = [memories[i]];
      processed.add(memories[i].id);

      for (let j = i + 1; j < memories.length; j++) {
        if (processed.has(memories[j].id)) continue;

        const similarity = this.calculateCosineSimilarity(
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

  // ===== 私有方法 =====

  private async generateCompressedContent(memories: Memory[]): Promise<string> {
    const memoriesText = memories.map((m, i) =>
      `[${i + 1}] (${new Date(m.metadata.timestamp).toLocaleString()}) ${m.content}`
    ).join('\n\n');
    const prompt = this.promptTemplate.replace('{memories}', memoriesText);
    const { content } = await this.modelService
      .withStructuredOutput<{ content: string }>(CompressionSchema)
      .invoke([new HumanMessage(prompt)]);
    return content;
  }

  private calculateCosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vector dimension mismatch");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const similarity = dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    return (similarity + 1) / 2;
  }
}
