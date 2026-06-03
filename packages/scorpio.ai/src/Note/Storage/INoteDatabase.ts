import { Note, NoteResult } from "../types";

/**
 * 笔记数据库接口（资料库模式）
 */
export interface INoteDatabase {
    // --- 查询 ---

    getAllNotes(): Promise<Note[]>;

    searchWithTimeDecay(
        queryEmbedding: number[],
        currentTime: number,
        decayFactor?: number,
        limit?: number
    ): Promise<NoteResult[]>;

    findDuplicate(
        queryEmbedding: number[],
        threshold?: number
    ): Promise<{ note: Note; score: number } | undefined>;

    // --- 写入 ---

    insertNote(note: Note): Promise<void>;

    updateNote(id: string, content: string, embedding: number[]): Promise<void>;

    updateAccess(noteId: string): Promise<void>;

    deleteNote(id: string): Promise<void>;

    clearNotes(): Promise<number>;

    // --- 生命周期 ---

    dispose(): Promise<void>;
}

export const INoteDatabase = Symbol("INoteDatabase");
