/**
 * 记忆类型枚举
 */
export enum MemoryType {
  SHORT_TERM = "short_term",    // 短期记忆：当前会话上下文
  EPISODIC = "episodic",        // 情节记忆：具体事件和交互历史
  SEMANTIC = "semantic"          // 语义记忆：通用知识和事实
}

/**
 * 记忆元数据接口
 */
export interface MemoryMetadata {
  timestamp: number;          // 创建时间戳
  userId: string;             // 用户ID
  sessionId?: string;         // 会话ID
  importance: number;         // 重要性评分 (0-1)
  accessCount: number;        // 访问次数
  lastAccessed: number;       // 最后访问时间
  tags?: string[];            // 标签
  [key: string]: any;         // 其他元数据
}

/**
 * 记忆接口
 */
export interface Memory {
  id: string;
  type: MemoryType;
  content: string;              // 原始文本内容
  embedding: number[];          // 向量嵌入
  metadata: MemoryMetadata;
}

/**
 * 记忆检索选项
 */
export interface MemoryRetrievalOptions {
  limit?: number;               // 返回结果数量
  type?: MemoryType;            // 记忆类型过滤
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
