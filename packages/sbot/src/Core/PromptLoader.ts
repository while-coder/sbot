import path from 'path';
import fs from 'fs';
import { config } from './Config';

const PROMPTS_BASE = path.resolve(__dirname, '../../prompts');

/**
 * Load a prompt file, with user override support.
 * Checks ~/.sbot/prompts/{relPath} first; falls back to the bundled prompts/ directory.
 */
export function loadPrompt(relPath: string, vars?: Record<string, string>): string {
    const userPath = config.getConfigPath(`prompts/${relPath}`);
    let text: string;
    if (fs.existsSync(userPath)) {
        text = fs.readFileSync(userPath, 'utf-8').trim();
    } else {
        const defaultPath = path.join(PROMPTS_BASE, relPath);
        if (fs.existsSync(defaultPath)) {
            text = fs.readFileSync(defaultPath, 'utf-8').trim();
        } else {
            throw new Error(`Prompt file not found: ${relPath}`);
        }
    }
    if (vars) {
        for (const [k, v] of Object.entries(vars)) {
            text = text.replaceAll(`{${k}}`, v);
        }
    }
    return text;
}
