import fs from "fs";
import path from "path";

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

export function getAgendaPromptsDir(): string {
    return path.join(__dirname, "prompts");
}

/**
 * Load an Agenda prompt, preferring the host's user override directory and
 * falling back to the prompt bundled with this package.
 */
export function loadAgendaPrompt(relPath: string, overrideRoot?: string): string {
    const overridePath = overrideRoot ? path.join(overrideRoot, relPath) : undefined;
    const bundledPath = path.join(getAgendaPromptsDir(), relPath);
    const filePath = overridePath && fs.existsSync(overridePath) ? overridePath : bundledPath;
    if (!fs.existsSync(filePath)) throw new Error(`Agenda prompt file not found: ${relPath}`);
    return fs.readFileSync(filePath, "utf8").trim().replace(FRONTMATTER_RE, "").trim();
}
