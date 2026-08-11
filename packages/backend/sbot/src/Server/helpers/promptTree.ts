import fs from 'fs';
import path from 'path';

function dirFirstByName(a: fs.Dirent, b: fs.Dirent): number {
    if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
    return a.name.localeCompare(b.name);
}

export type PromptNode = { name: string; type: 'file' | 'dir'; path: string; isOverride?: boolean; isUserOnly?: boolean; children?: PromptNode[] };

export class PromptTreeHelper {
    readonly PROMPTS_DIR = path.resolve(__dirname, '../../../prompts');

    buildFromRoots(defaultDirs: string[], userBaseDir = ''): PromptNode[] {
        let result: PromptNode[] = [];
        for (const dir of defaultDirs) {
            result = this.mergeDefaults(result, this.build(dir));
        }
        if (userBaseDir && fs.existsSync(userBaseDir)) {
            result = this.overlayUser(result, this.build(userBaseDir));
        }
        return this.sortNodes(result);
    }

    resolveDefault(defaultDirs: string[], relPath: string): string | undefined {
        return defaultDirs
            .map(dir => path.join(dir, relPath))
            .find(filePath => fs.existsSync(filePath));
    }

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

    private mergeDefaults(base: PromptNode[], extra: PromptNode[]): PromptNode[] {
        const result = [...base];
        for (const node of extra) {
            const current = result.find(item => item.name === node.name && item.type === node.type);
            if (!current) {
                result.push(node);
            } else if (node.type === 'dir') {
                current.children = this.mergeDefaults(current.children ?? [], node.children ?? []);
            }
        }
        return this.sortNodes(result);
    }

    private overlayUser(defaults: PromptNode[], users: PromptNode[]): PromptNode[] {
        const result = [...defaults];
        for (const user of users) {
            const current = result.find(item => item.name === user.name && item.type === user.type);
            if (!current) {
                result.push(this.markUserOnly(user));
            } else if (user.type === 'dir') {
                current.children = this.overlayUser(current.children ?? [], user.children ?? []);
                current.isOverride = current.children.some(item => item.isOverride || item.isUserOnly);
            } else {
                current.isOverride = true;
            }
        }
        return this.sortNodes(result);
    }

    private markUserOnly(node: PromptNode): PromptNode {
        return {
            ...node,
            isUserOnly: true,
            children: node.children?.map(child => this.markUserOnly(child)),
        };
    }

    private sortNodes(nodes: PromptNode[]): PromptNode[] {
        return nodes.sort((a, b) => {
            if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
            return a.name.localeCompare(b.name);
        });
    }
}

export const promptTreeHelper = new PromptTreeHelper();
