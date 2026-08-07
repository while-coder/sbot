/**
 * 笔记接口
 */
export interface Note {
  id: string;
  content: string;
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
