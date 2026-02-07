import { inject } from "../Core";
import { IModelService, ModelServiceFactory } from "../Model";
import { Memory, MemoryType } from "./types";
import { LoggerService } from "../LoggerService";

const logger = LoggerService.getLogger("MemoryCompressor.ts");

/**
 * 压缩结果
 */
export interface CompressionResult {
  compressedMemory: Memory;
  sourceMemoryIds: string[];
  compressionRatio: number;
  summary: string;
}

/**
 * 合并策略
 */
export enum MergeStrategy {
  CHRONOLOGICAL = "chronological",
  THEMATIC = "thematic",
  IMPORTANCE = "importance"
}

/**
 * 记忆压缩器
 * 使用 LLM 合并和压缩相似或相关的记忆
 *
 * @example
 * ```ts
 * const compressor = new MemoryCompressor("gpt-4", modelFactory);
 * const result = await compressor.compress(memories, MergeStrategy.CHRONOLOGICAL, embedFn);
 * ```
 */
export class MemoryCompressor {
  private modelService: IModelService | null = null;

  constructor(
    private modelName: string,
    @inject(ModelServiceFactory) private modelFactory: ModelServiceFactory
  ) {}

  /**
   * 获取模型服务实例（懒加载 + 缓存）
   */
  private async getModelService(): Promise<IModelService> {
    if (!this.modelService) {
      this.modelService = await this.modelFactory.getModelService(this.modelName);
    }
    return this.modelService;
  }

  /**
   * 压缩多个记忆为一个
   */
  async compress(
    memories: Memory[],
    strategy: MergeStrategy,
    generateEmbedding: (text: string) => Promise<number[]>
  ): Promise<CompressionResult | null> {
    if (memories.length < 2) {
      logger.warn("至少需要2条记忆才能压缩");
      return null;
    }

    try {
      const sortedMemories = this.sortMemoriesByStrategy(memories, strategy);
      const compressedContent = await this.generateCompressedContent(sortedMemories, strategy);
      const newEmbedding = await generateEmbedding(compressedContent);

      const avgImportance = memories.reduce((sum, m) => sum + m.metadata.importance, 0) / memories.length;
      const maxImportance = Math.max(...memories.map(m => m.metadata.importance));
      const finalImportance = (avgImportance + maxImportance) / 2;

      const allTags = new Set<string>();
      memories.forEach(m => {
        if (m.metadata.tags) {
          m.metadata.tags.forEach(tag => allTags.add(tag));
        }
      });

      const compressedMemory: Memory = {
        id: `compressed_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        type: this.determineMemoryType(memories),
        content: compressedContent,
        embedding: newEmbedding,
        metadata: {
          timestamp: Date.now(),
          userId: memories[0].metadata.userId,
          importance: finalImportance,
          accessCount: memories.reduce((sum, m) => sum + m.metadata.accessCount, 0),
          lastAccessed: Date.now(),
          tags: Array.from(allTags),
          compressed: true,
          sourceCount: memories.length,
          originalTimestamps: memories.map(m => m.metadata.timestamp),
          compressionStrategy: strategy
        }
      };

      const originalLength = memories.reduce((sum, m) => sum + m.content.length, 0);
      const compressionRatio = compressedContent.length / originalLength;

      logger.info(`成功压缩 ${memories.length} 条记忆，压缩比: ${(compressionRatio * 100).toFixed(1)}%`);

      return {
        compressedMemory,
        sourceMemoryIds: memories.map(m => m.id),
        compressionRatio,
        summary: `将 ${memories.length} 条记忆压缩为 1 条，压缩比 ${(compressionRatio * 100).toFixed(1)}%`
      };
    } catch (error: any) {
      logger.error(`记忆压缩失败: ${error.message}`);
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

    logger.debug(`找到 ${groups.length} 个可压缩的记忆组`);
    return groups;
  }

  /**
   * 按时间范围压缩记忆
   */
  groupByTimeWindow(
    memories: Memory[],
    timeWindowMs: number,
    minGroupSize: number = 3
  ): Memory[][] {
    const sorted = [...memories].sort((a, b) => a.metadata.timestamp - b.metadata.timestamp);

    const groups: Memory[][] = [];
    let currentGroup: Memory[] = [];

    for (const memory of sorted) {
      if (currentGroup.length === 0) {
        currentGroup.push(memory);
        continue;
      }

      const lastTime = currentGroup[currentGroup.length - 1].metadata.timestamp;
      const timeDiff = memory.metadata.timestamp - lastTime;

      if (timeDiff <= timeWindowMs) {
        currentGroup.push(memory);
      } else {
        if (currentGroup.length >= minGroupSize) {
          groups.push(currentGroup);
        }
        currentGroup = [memory];
      }
    }

    if (currentGroup.length >= minGroupSize) {
      groups.push(currentGroup);
    }

    logger.debug(`按时间窗口（${timeWindowMs}ms）分组，找到 ${groups.length} 组`);
    return groups;
  }

  /**
   * 估算压缩收益
   */
  estimateCompressionBenefit(memories: Memory[]): number {
    const totalLength = memories.reduce((sum, m) => sum + m.content.length, 0);
    const estimatedCompressedLength = totalLength * 0.6;
    return totalLength - estimatedCompressedLength;
  }

  // ===== 私有方法 =====

  private async generateCompressedContent(
    memories: Memory[],
    strategy: MergeStrategy
  ): Promise<string> {
    const model = await this.getModelService();
    const prompt = this.buildCompressionPrompt(memories, strategy);
    const response = await model.invoke(prompt);
    return this.cleanCompressedContent(response.content);
  }

  private buildCompressionPrompt(memories: Memory[], strategy: MergeStrategy): string {
    const memoriesText = memories.map((m, i) =>
      `[${i + 1}] (${new Date(m.metadata.timestamp).toLocaleString()}) ${m.content}`
    ).join('\n\n');

    let strategyInstruction = '';
    switch (strategy) {
      case MergeStrategy.CHRONOLOGICAL:
        strategyInstruction = '按时间顺序整合这些记忆，保持事件的时间线';
        break;
      case MergeStrategy.THEMATIC:
        strategyInstruction = '按主题整合这些记忆，将相关的信息归类';
        break;
      case MergeStrategy.IMPORTANCE:
        strategyInstruction = '优先保留重要信息，简化次要细节';
        break;
    }

    return `你是一个记忆整合专家。请将以下多条记忆整合为一条简洁但完整的记忆。

整合策略：${strategyInstruction}

要整合的记忆：
${memoriesText}

要求：
1. 保留所有关键信息和重要细节
2. 消除重复内容
3. 使用简洁清晰的语言
4. 保持事实准确性
5. 不要添加原文中没有的信息
6. 最终结果应该比原文更短，但信息密度更高

请直接输出整合后的记忆内容，不要添加任何解释或注释：`;
  }

  private cleanCompressedContent(content: string): string {
    return content
      .replace(/^整合后的记忆[：:]\s*/i, '')
      .replace(/^压缩结果[：:]\s*/i, '')
      .replace(/^结果[：:]\s*/i, '')
      .trim();
  }

  private sortMemoriesByStrategy(memories: Memory[], strategy: MergeStrategy): Memory[] {
    const sorted = [...memories];
    switch (strategy) {
      case MergeStrategy.CHRONOLOGICAL:
        return sorted.sort((a, b) => a.metadata.timestamp - b.metadata.timestamp);
      case MergeStrategy.IMPORTANCE:
        return sorted.sort((a, b) => b.metadata.importance - a.metadata.importance);
      case MergeStrategy.THEMATIC:
        return sorted;
      default:
        return sorted;
    }
  }

  private determineMemoryType(memories: Memory[]): MemoryType {
    const typeCounts = memories.reduce((acc, m) => {
      acc[m.type] = (acc[m.type] || 0) + 1;
      return acc;
    }, {} as Record<MemoryType, number>);

    let maxType = memories[0].type;
    let maxCount = 0;

    for (const [type, count] of Object.entries(typeCounts)) {
      if (count > maxCount) {
        maxCount = count;
        maxType = type as MemoryType;
      }
    }

    return maxType;
  }

  private calculateCosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("向量维度不匹配");
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
