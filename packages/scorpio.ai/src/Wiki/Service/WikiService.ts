import { v4 as uuidv4 } from "uuid";
import path from "path";
import { inject, init, T_DBPath } from "../../Core";
import { IEmbeddingService } from "../../Embedding";
import { HybridSearcher, SearchableItem } from "../../Retrieval/HybridSearcher";
import { IWikiDatabase } from "../Database/IWikiDatabase";
import { WikiPage, WikiSearchResult } from "../Types";
import { IWikiService } from "./IWikiService";

const toSearchable = (page: WikiPage): SearchableItem => ({
  key: page.id,
  text: page.title + '\n' + page.content,
});

export class WikiService implements IWikiService {
  private searcher: HybridSearcher;

  constructor(
    @inject(IWikiDatabase) private db: IWikiDatabase,
    @inject(T_DBPath) dbPath: string,
    @inject(IEmbeddingService, { optional: true }) private embeddings?: IEmbeddingService,
  ) {
    this.searcher = new HybridSearcher({
      cachePath: path.join(dbPath, '.wiki-embeddings.json'),
    });
  }

  @init()
  async initialize(): Promise<void> {
    const pages = await this.db.getAll();
    if (pages.length === 0) return;
    if (this.embeddings) {
      try {
        await this.searcher.buildIndex(pages.map(toSearchable), this.embeddings);
      } catch { /* graceful fallback */ }
    } else {
      this.searcher.buildIndexWithoutEmbeddings(pages.map(toSearchable));
    }
  }

  // -- CRUD -----------------------------------------------------------------

  async createPage(
    title: string,
    content: string,
    tags: string[] = [],
  ): Promise<WikiPage> {
    const id = uuidv4();
    const now = Date.now();

    const page: WikiPage = {
      id,
      title,
      content,
      tags,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(page);

    if (this.embeddings) {
      try { await this.searcher.updateEntry(id, title + '\n' + content, this.embeddings); } catch { /* best-effort */ }
    }

    return page;
  }

  async getPage(id: string): Promise<WikiPage | null> {
    return this.db.getById(id);
  }

  async getPageByTitle(title: string): Promise<WikiPage | null> {
    return this.db.getByTitle(title);
  }

  async updatePage(
    id: string,
    updates: Partial<Pick<WikiPage, "title" | "content" | "tags">>,
  ): Promise<WikiPage> {
    const existing = await this.db.getById(id);
    if (!existing) {
      throw new Error(`WikiPage not found: ${id}`);
    }

    const updated: WikiPage = {
      ...existing,
      ...updates,
      version: existing.version + 1,
      updatedAt: Date.now(),
    };

    await this.db.update(id, updated);

    if (this.embeddings) {
      try { await this.searcher.updateEntry(id, updated.title + '\n' + updated.content, this.embeddings); } catch { /* best-effort */ }
    }

    return updated;
  }

  async deletePage(id: string): Promise<void> {
    await this.db.delete(id);
    this.searcher.removeEntry(id);
  }

  // -- Search ---------------------------------------------------------------

  async search(query: string, limit: number = 5): Promise<WikiSearchResult[]> {
    const pages = await this.db.getAll();
    if (pages.length === 0) return [];

    const results = await this.searcher.search(
      query,
      pages,
      toSearchable,
      limit,
      this.embeddings,
    );

    return results.map(page => ({
      page,
      score: 1,
      snippet: this.createSnippet(page.content),
    }));
  }

  async searchByTag(tag: string, limit: number = 20): Promise<WikiPage[]> {
    const pages = await this.db.getByTags([tag]);
    return pages.slice(0, limit);
  }

  async getAllPages(): Promise<WikiPage[]> {
    return this.db.getAll();
  }

  // -- Lifecycle ------------------------------------------------------------

  async dispose(): Promise<void> {
    await this.db.dispose();
  }

  // -- Private --------------------------------------------------------------

  private createSnippet(content: string, maxLength: number = 200): string {
    return content.length <= maxLength
      ? content
      : content.substring(0, maxLength) + "...";
  }
}
