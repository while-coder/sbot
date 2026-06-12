import { Note } from "../types";

/**
 * 笔记数据库接口（资料库模式）
 *
 * 纯 CRUD：embedding / 向量检索 / 去重 由 HybridSearcher 统一管理，
 * db 只持有元数据（id / content / access 计数 / 时间戳）。
 */
export interface INoteDatabase {
    // --- 查询 ---

    getAllNotes(): Promise<Note[]>;

    getNoteById(id: string): Promise<Note | null>;

    // --- 写入 ---

    insertNote(note: Note): Promise<void>;

    updateNoteContent(id: string, content: string): Promise<void>;

    updateAccess(noteId: string): Promise<void>;

    deleteNote(id: string): Promise<void>;

    clearNotes(): Promise<number>;

    // --- 生命周期 ---

    dispose(): Promise<void>;
}

export const INoteDatabase = Symbol("INoteDatabase");
