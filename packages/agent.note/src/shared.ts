import fs from "fs";
import path from "path";

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

export const T_NoteSystemPromptTemplate = Symbol("agent.note:T_NoteSystemPromptTemplate");
/** Note HybridSearcher 的 cachePath（每个 Note 一份 searcher.sqlite）。 */
export const T_NoteCachePath = Symbol("agent.note:T_NoteCachePath");
export const T_NoteToolDescs = Symbol("agent.note:T_NoteToolDescs");

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

export function getNotePromptsDir(): string {
    return path.join(__dirname, "prompts");
}

/** 优先读取宿主的用户覆盖目录，否则读取 package 内置 prompt。 */
export function loadNotePrompt(relPath: string, overrideRoot?: string): string {
    const overridePath = overrideRoot ? path.join(overrideRoot, relPath) : undefined;
    const bundledPath = path.join(getNotePromptsDir(), relPath);
    const filePath = overridePath && fs.existsSync(overridePath) ? overridePath : bundledPath;
    if (!fs.existsSync(filePath)) throw new Error(`Note prompt file not found: ${relPath}`);
    return fs.readFileSync(filePath, "utf8").trim().replace(FRONTMATTER_RE, "").trim();
}
