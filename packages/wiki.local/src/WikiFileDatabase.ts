import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import type { IWikiDatabase, WikiPage } from "wiki.base";

/**
 * 本地 Markdown 文件存储：每个 wiki 页面是一个带 YAML frontmatter 的 .md 文件，
 * 存放在插件分配的缓存目录（config/wiki/{wikiId}）下。
 */
export class WikiFileDatabase implements IWikiDatabase {
    private readonly dir: string;

    constructor(dir: string) {
        this.dir = dir;
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    // --- 查询 ---

    async getById(id: string): Promise<WikiPage | null> {
        const filePath = this.pageFilePath(id);
        if (!existsSync(filePath)) return null;
        try {
            const content = readFileSync(filePath, "utf-8");
            return this.parsePage(content);
        } catch {
            return null;
        }
    }

    async getByTags(tags: string[]): Promise<WikiPage[]> {
        return this.readAllPages().filter(p => tags.some(t => p.tags.includes(t)));
    }


    async getAll(): Promise<WikiPage[]> {
        return this.readAllPages();
    }

    // --- 写入 ---

    async insert(page: WikiPage): Promise<void> {
        const filePath = this.pageFilePath(page.id);
        writeFileSync(filePath, this.serializePage(page), "utf-8");
    }

    async update(id: string, updates: Partial<WikiPage>): Promise<void> {
        const existing = await this.getById(id);
        if (!existing) return;

        const merged: WikiPage = {
            ...existing,
            ...updates,
            version: (updates.version ?? existing.version + 1),
            updatedAt: updates.updatedAt ?? Date.now(),
        };

        const filePath = this.pageFilePath(id);
        writeFileSync(filePath, this.serializePage(merged), "utf-8");
    }

    async delete(id: string): Promise<void> {
        const filePath = this.pageFilePath(id);
        if (existsSync(filePath)) unlinkSync(filePath);
    }

    // --- 生命周期 ---

    async dispose(): Promise<void> { /* no-op for file-based storage */ }

    // --- Private ---

    private readAllPages(): WikiPage[] {
        if (!existsSync(this.dir)) return [];
        const files = readdirSync(this.dir).filter(f => f.endsWith(".md"));
        const pages: WikiPage[] = [];
        for (const file of files) {
            try {
                const content = readFileSync(join(this.dir, file), "utf-8");
                const page = this.parsePage(content);
                if (page) pages.push(page);
            } catch {
                // skip malformed files
            }
        }
        return pages;
    }

    private parsePage(raw: string): WikiPage | null {
        // Parse YAML frontmatter between --- delimiters
        const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (!match) return null;

        const frontmatter = match[1];
        const content = match[2].trim();

        // Simple YAML parsing for our known fields
        const meta: Record<string, any> = {};
        for (const line of frontmatter.split("\n")) {
            const idx = line.indexOf(":");
            if (idx === -1) continue;
            const key = line.substring(0, idx).trim();
            let value: string | number | boolean = line.substring(idx + 1).trim();
            // Remove surrounding quotes
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            meta[key] = value;
        }

        // Parse JSON array fields
        const parseArray = (val: any): string[] => {
            if (!val) return [];
            try { return JSON.parse(val); } catch { return []; }
        };


        if (!meta.id || !meta.title) return null;

        return {
            id: String(meta.id),
            title: String(meta.title),
            content,
            tags: parseArray(meta.tags),
            version: parseInt(meta.version) || 1,
            createdAt: parseInt(meta.createdAt) || Date.now(),
            updatedAt: parseInt(meta.updatedAt) || Date.now(),
        };
    }

    private serializePage(page: WikiPage): string {
        const lines = [
            "---",
            `id: "${page.id}"`,
            `title: "${page.title}"`,
            `tags: ${JSON.stringify(page.tags)}`,
            `version: ${page.version}`,
            `createdAt: ${page.createdAt}`,
            `updatedAt: ${page.updatedAt}`,
        ];
        lines.push("---");

        return lines.join("\n") + "\n" + page.content + "\n";
    }

    private pageFilePath(id: string): string {
        return join(this.dir, `${id}.md`);
    }
}
