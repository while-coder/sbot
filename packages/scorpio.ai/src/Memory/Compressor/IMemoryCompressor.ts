import { Memory } from "../types";

/**
 * 压缩结果
 */
export interface CompressionResult {
  compressedMemory: Memory;     // 压缩后的记忆
  sourceMemoryIds: string[];    // 源记忆ID列表
  compressionRatio: number;     // 压缩比 (0-1)
  summary: string;              // 压缩摘要
}

/**
 * 合并策略
 */
export enum MergeStrategy {
  CHRONOLOGICAL = "chronological",  // 按时间顺序
  THEMATIC = "thematic",           // 按主题
  IMPORTANCE = "importance"        // 按重要性
}

/**
 * 记忆压缩器接口
 * 负责合并和压缩相似或相关的记忆
 */
export interface IMemoryCompressor {
  /**
   * 压缩多个记忆为一个
   * @param memories 要压缩的记忆数组
   * @param strategy 合并策略
   * @param generateEmbedding 生成向量嵌入的函数
   * @returns 压缩结果，如果无法压缩则返回 null
   */
  compress(
    memories: Memory[],
    strategy: MergeStrategy,
    generateEmbedding: (text: string) => Promise<number[]>
  ): Promise<CompressionResult | null>;

  /**
   * 查找可以压缩的记忆组
   * @param memories 记忆数组
   * @param similarityThreshold 相似度阈值 (0-1)
   * @returns 可压缩的记忆组数组
   */
  findCompressibleGroups(
    memories: Memory[],
    similarityThreshold?: number
  ): Memory[][];
}

/**
 * IMemoryCompressor 的依赖注入 token
 * 使用 Symbol 确保唯一性，避免命名冲突
 */
export const IMemoryCompressor = Symbol("IMemoryCompressor");
