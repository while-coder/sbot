/**
 * 记忆接口
 */
export interface Memory {
  id: string;
  content: string;
  embedding: number[];
  createdAt: number;
  accessCount: number;
  lastAccessed: number;
}

/**
 * 记忆搜索结果
 */
export interface MemoryResult {
  memory: Memory;
  score: number;
}
