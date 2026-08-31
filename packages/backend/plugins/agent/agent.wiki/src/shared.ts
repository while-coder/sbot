import fs from "fs";
import path from "path";

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

export const T_WikiSystemPromptTemplate = Symbol("agent.wiki:T_WikiSystemPromptTemplate");
/** Wiki HybridSearcher 的 cachePath（每个 Wiki 一份 searcher.sqlite）。 */
export const T_WikiCachePath = Symbol("agent.wiki:T_WikiCachePath");
export const T_WikiToolDescs = Symbol("agent.wiki:T_WikiToolDescs");
/** 本 Wiki 的唯一标识（settings.wikis 的 key），供工具层跨库路由与歧义检测。 */
export const T_WikiId = Symbol("agent.wiki:T_WikiId");

/**
 * Wiki 页面
 */
export interface WikiPage {
  id: string;
  title: string;
  content: string;
  tags: string[];
  version: number;
  createdAt: number;
  updatedAt: number;
}

export function getWikiPromptsDir(): string {
    return path.join(__dirname, "prompts");
}

/** 优先读取宿主的用户覆盖目录，否则读取 package 内置 prompt。 */
export function loadWikiPrompt(relPath: string, overrideRoot?: string): string {
    const overridePath = overrideRoot ? path.join(overrideRoot, relPath) : undefined;
    const bundledPath = path.join(getWikiPromptsDir(), relPath);
    const filePath = overridePath && fs.existsSync(overridePath) ? overridePath : bundledPath;
    if (!fs.existsSync(filePath)) throw new Error(`Wiki prompt file not found: ${relPath}`);
    return fs.readFileSync(filePath, "utf8").trim().replace(FRONTMATTER_RE, "").trim();
}
