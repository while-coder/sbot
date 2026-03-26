/**
 * 对话记忆化模式
 */
export enum MemoryMode {
  READ_ONLY = "read_only",           // 只读，不写入新记忆
  HUMAN_ONLY = "human_only",         // 仅记忆用户消息
  HUMAN_AND_AI = "human_and_ai"      // 记忆用户消息 + AI 回复
}

/**
 * 记忆元数据接口
 */
export interface MemoryMetadata {
  // --- 基础 ---
  timestamp: number;              // 创建时间戳
  // --- 评分 ---
  importance: number;             // 重要性评分 (0-1)
  accessCount: number;            // 访问次数
  lastAccessed: number;           // 最后访问时间
  // --- 压缩记忆 ---
  compressed?: boolean;           // 是否为压缩记忆
  sourceCount?: number;           // 来源记忆数量
  originalTimestamps?: number[];  // 来源记忆的原始时间戳
  compressionStrategy?: string;   // 压缩策略
}

/**
 * 记忆接口
 */
export interface Memory {
  id: string;
  content: string;
  embedding: number[];
  metadata: MemoryMetadata;
}

/**
 * 记忆检索选项
 */
export interface MemoryRetrievalOptions {
  limit?: number;               // 返回结果数量
  useTimeDecay?: boolean;       // 是否使用时间衰减
  minImportance?: number;       // 最低重要性阈值
  keywords?: string[];          // 关键词过滤
}

/**
 * 记忆搜索结果
 */
export interface MemorySearchResult {
  memory: Memory;
  score: number;                // 相关性得分
  distance?: number;            // 向量距离
}

/**
 * getMemories 返回结果
 */
export interface MemoryResult {
  memory: Memory;
  decayedScore: number;         // 综合得分（时间衰减 + 重要性 + 访问频次）
}

