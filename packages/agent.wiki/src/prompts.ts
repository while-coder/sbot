import fs from "fs";
import path from "path";

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

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
