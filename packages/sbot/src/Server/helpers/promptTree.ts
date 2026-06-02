import fs from 'fs';
import path from 'path';
import { dirFirstByName } from '../utils';

export type PromptNode = { name: string; type: 'file' | 'dir'; path: string; isOverride?: boolean; isUserOnly?: boolean; children?: PromptNode[] };

export class PromptTreeHelper {
    readonly PROMPTS_DIR = path.resolve(__dirname, '../../../prompts');

    build(dir: string, basePath = '', userBaseDir = ''): PromptNode[] {
        if (!fs.existsSync(dir)) return [];
        const entries = fs.readdirSync(dir, { withFileTypes: true }).sort(dirFirstByName);
        const result: PromptNode[] = [];
        const seen = new Set<string>();
        for (const entry of entries) {
            const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;
            seen.add(entry.name);
            if (entry.isDirectory()) {
                const children = this.build(path.join(dir, entry.name), relPath, userBaseDir);
                const anyOverride = children.some(c => c.isOverride || c.isUserOnly || c.children?.some(cc => cc.isOverride || cc.isUserOnly));
                result.push({ name: entry.name, type: 'dir', path: relPath, isOverride: anyOverride, children });
            } else if (entry.isFile()) {
                const isOverride = userBaseDir ? fs.existsSync(path.join(userBaseDir, relPath)) : false;
                result.push({ name: entry.name, type: 'file', path: relPath, isOverride });
            }
        }
        if (userBaseDir) {
            const userDir = basePath ? path.join(userBaseDir, basePath) : userBaseDir;
            if (fs.existsSync(userDir)) {
                const userEntries = fs.readdirSync(userDir, { withFileTypes: true })
                    .filter(e => !seen.has(e.name))
                    .sort(dirFirstByName);
                for (const entry of userEntries) {
                    const relPath = basePath ? `${basePath}/${entry.name}` : entry.name;
                    if (entry.isDirectory()) {
                        const children = this.build(path.join(userDir, entry.name), relPath, userBaseDir);
                        result.push({ name: entry.name, type: 'dir', path: relPath, isUserOnly: true, children });
                    } else if (entry.isFile()) {
                        result.push({ name: entry.name, type: 'file', path: relPath, isUserOnly: true });
                    }
                }
            }
        }
        return result;
    }
}

export const promptTreeHelper = new PromptTreeHelper();
