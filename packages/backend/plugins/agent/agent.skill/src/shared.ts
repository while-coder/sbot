import fs from "fs";
import path from "path";

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

export const T_SkillSystemPromptTemplate = Symbol("agent.skill:T_SkillSystemPromptTemplate");
export const T_SkillToolReadDesc = Symbol("agent.skill:T_SkillToolReadDesc");
export const T_SkillToolListDesc = Symbol("agent.skill:T_SkillToolListDesc");
export const T_SkillToolExecDesc = Symbol("agent.skill:T_SkillToolExecDesc");

export interface Skill {
    name: string;
    description: string;
    license?: string;
    path: string;
    type?: string;
    metadata?: Record<string, any>;
}

export function getSkillPromptsDir(): string {
    return path.join(__dirname, "prompts");
}

export function loadSkillPrompt(relPath: string, overrideRoot?: string): string {
    const overridePath = overrideRoot ? path.join(overrideRoot, relPath) : undefined;
    const bundledPath = path.join(getSkillPromptsDir(), relPath);
    const filePath = overridePath && fs.existsSync(overridePath) ? overridePath : bundledPath;
    if (!fs.existsSync(filePath)) throw new Error(`Skill prompt file not found: ${relPath}`);
    return fs.readFileSync(filePath, "utf8").trim().replace(FRONTMATTER_RE, "").trim();
}
