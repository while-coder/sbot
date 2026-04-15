import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { inject, T_DBPath } from "../../Core";
import { WikiPage, WikiPageSource } from "../Types";
import { IWikiDatabase } from "./IWikiDatabase";

export class WikiFileDatabase implements IWikiDatabase {
    private readonly dir: string;

    constructor(@inject(T_DBPath) dir: string) {
        this.dir = dir;
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    }

    // --- 查询 ---

    async getById(id: string): Promise<WikiPage | null> {
        for (const page of this.readAllPages()) {
            if (page.id === id) return page;
        }
        return null;
    }

    async getByTitle(title: string): Promise<WikiPage | null> {
        for (const page of this.readAllPages()) {
            if (page.title === title) return page;
        }
        return null;
    }

    async getByTags(tags: string[]): Promise<WikiPage[]> {
        return this.readAllPages().filter(p => tags.some(t => p.tags.includes(t)));
    }

    async searchByText(query: string, limit: number): Promise<WikiPage[]> {
        const q = query.toLowerCase();
        return this.readAllPages()
            .filter(p => p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q))
            .slice(0, limit);
    }


    async getAll(): Promise<WikiPage[]> {
        return this.readAllPages();
    }

    // --- 写入 ---

    async insert(page: WikiPage): Promise<void> {
        const filePath = this.pageFilePath(page.title);
        writeFileSync(filePath, this.serializePage(page), "utf-8");
    }

    async update(id: string, updates: Partial<WikiPage>): Promise<void> {
        const existing = await this.getById(id);
        if (!existing) return;

        // If title changed, delete old file
        if (updates.title && updates.title !== existing.title) {
            const oldPath = this.pageFilePath(existing.title);
            if (existsSync(oldPath)) unlinkSync(oldPath);
        }

        const merged: WikiPage = {
            ...existing,
            ...updates,
            version: (updates.version ?? existing.version + 1),
            updatedAt: updates.updatedAt ?? Date.now(),
        };

        const filePath = this.pageFilePath(merged.title);
        writeFileSync(filePath, this.serializePage(merged), "utf-8");
    }

    async delete(id: string): Promise<void> {
        const page = await this.getById(id);
        if (!page) return;
        const filePath = this.pageFilePath(page.title);
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

        const parseObj = (val: any): Record<string, any> => {
            if (!val) return {};
            try { return JSON.parse(val); } catch { return {}; }
        };

        if (!meta.id || !meta.title) return null;

        return {
            id: String(meta.id),
            title: String(meta.title),
            content,
            tags: parseArray(meta.tags),
            links: parseArray(meta.links),
            metadata: parseObj(meta.metadata),
            version: parseInt(meta.version) || 1,
            source: (meta.source || "manual") as WikiPageSource,
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
            `links: ${JSON.stringify(page.links)}`,
            `metadata: ${JSON.stringify(page.metadata)}`,
            `version: ${page.version}`,
            `source: ${page.source}`,
            `createdAt: ${page.createdAt}`,
            `updatedAt: ${page.updatedAt}`,
        ];
        lines.push("---");

        return lines.join("\n") + "\n" + page.content + "\n";
    }

    private pageFilePath(title: string): string {
        // Slugify: lowercase, replace non-alphanumeric with hyphens, collapse
        const slug = title
            .toLowerCase()
            .replace(/[^a-z0-9\u4e00-\u9fff]+/gi, "-")
            .replace(/^-+|-+$/g, "");
        return join(this.dir, `${slug || "untitled"}.md`);
    }
}
