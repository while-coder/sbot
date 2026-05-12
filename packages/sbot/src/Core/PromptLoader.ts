import path from 'path';
import fs from 'fs';
import { config } from './Config';

const PROMPTS_BASE = path.resolve(__dirname, '../../prompts');

export interface PromptVarMeta {
    name: string;
    description: string;
}

export interface PromptMeta {
    vars: PromptVarMeta[];
    body: string;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

function parseFrontmatter(raw: string): { vars: PromptVarMeta[]; body: string } {
    const match = raw.match(FRONTMATTER_RE);
    if (!match) return { vars: [], body: raw };

    const body = raw.slice(match[0].length);
    const vars: PromptVarMeta[] = [];

    let inVars = false;
    for (const line of match[1].split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === 'vars:') { inVars = true; continue; }
        if (inVars) {
            const m = trimmed.match(/^(\w+):\s*(.*)$/);
            if (m) {
                vars.push({ name: m[1], description: m[2].trim() });
            } else {
                inVars = false;
            }
        }
    }

    return { vars, body };
}

function resolvePromptPath(relPath: string): string {
    const userPath = config.getConfigPath(`prompts/${relPath}`);
    if (fs.existsSync(userPath)) return userPath;
    const defaultPath = path.join(PROMPTS_BASE, relPath);
    if (fs.existsSync(defaultPath)) return defaultPath;
    throw new Error(`Prompt file not found: ${relPath}`);
}

/**
 * Load a prompt file, with user override support.
 * Checks ~/.sbot/prompts/{relPath} first; falls back to the bundled prompts/ directory.
 */
export function loadPrompt(relPath: string, vars?: Record<string, string>): string {
    const filePath = resolvePromptPath(relPath);
    const raw = fs.readFileSync(filePath, 'utf-8').trim();
    const { body } = parseFrontmatter(raw);
    let text = body.trim();
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            text = text.replaceAll(`{${k}}`, v);
        }
    }
    return text;
}

/**
 * Load prompt metadata (vars declarations from frontmatter).
 * Used by admin API to display available template variables.
 */
export function loadPromptMeta(relPath: string, filePath?: string): PromptMeta {
    const resolved = filePath ?? resolvePromptPath(relPath);
    const raw = fs.readFileSync(resolved, 'utf-8').trim();
    const { vars, body } = parseFrontmatter(raw);
    return { vars, body: body.trim() };
}
