/**
 * 笔记接口
 */
export interface Note {
  id: string;
  content: string;
  embedding: number[];
  createdAt: number;
  accessCount: number;
  lastAccessed: number;
}

/**
 * 笔记搜索结果
 */
export interface NoteResult {
  note: Note;
  score: number;
}
