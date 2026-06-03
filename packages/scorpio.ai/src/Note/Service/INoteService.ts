import { Note, NoteResult } from "../types";
import { NoteToolDescs } from "../Tools/NoteToolProvider";

/**
 * 笔记服务接口（资料库模式）
 * 提供语义搜索和手动写入能力，不主动从对话中提取
 */
export interface INoteService {
    // ── 系统提示词 ────────────────────────────────────────────────────────────

    getSystemMessage(query: string): Promise<string | null>;

    // ── 工具描述（供 NoteToolProvider 使用） ──────────────────────────────────

    getToolDescs(): NoteToolDescs;

    // ── 读取 ──────────────────────────────────────────────────────────────────

    getNotes(query: string, limit?: number): Promise<NoteResult[]>;

    getAllNotes(): Promise<Note[]>;

    // ── 写入 ──────────────────────────────────────────────────────────────────

    /**
     * 直接插入一段完整笔记，跳过 Extractor
     * 大文本会自动按字符切割后分批插入（可通过 options.autoSplit 禁用）
     * 默认 chunkSize=500，可通过 options.chunkSize 自定义
     */
    addNoteDirect(content: string, options?: { autoSplit?: boolean; chunkSize?: number }): Promise<string[]>;

    /**
     * 更新已有条目的内容，重新生成向量
     */
    updateNoteDirect(noteId: string, content: string): Promise<void>;

    // ── 维护 ──────────────────────────────────────────────────────────────────

    deleteNote(noteId: string): Promise<void>;

    clearAll(): Promise<number>;

    // ── 生命周期 ──────────────────────────────────────────────────────────────

    dispose(): Promise<void>;
}

export const INoteService = Symbol("INoteService");
