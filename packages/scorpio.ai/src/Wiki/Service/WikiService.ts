import { v4 as uuidv4 } from "uuid";
import { inject, init, T_WikiSystemPromptTemplate } from "../../Core";
import { HybridSearcher, SearchableItem } from "../../Retrieval/HybridSearcher";
import { IWikiDatabase } from "../Database/IWikiDatabase";
import { WikiPage } from "../Types";
import { IWikiService } from "./IWikiService";

const toSearchable = (page: WikiPage): SearchableItem => ({
  key: page.id,
  text: page.title + '\n' + page.tags.join(' ') + '\n' + page.content,
  embeddingText: page.title,
});

export class WikiService implements IWikiService {
  private searcher: HybridSearcher;

  constructor(
    @inject(IWikiDatabase) private db: IWikiDatabase,
    @inject(T_WikiSystemPromptTemplate) private systemPromptTemplate: string,
  ) {
    this.searcher = new HybridSearcher({});
  }

  @init()
  async initialize(): Promise<void> {}

  async getSystemMessage(query: string): Promise<string | null> {
    const results = await this.search(query, 5);
    if (results.length === 0) return null;

    const items = results.map(r => {
      const tags = r.tags.length > 0 ? ` tags="${r.tags.join(', ')}"` : '';
      return `  <page id="${r.id}" title="${r.title}"${tags} />`;
    }).join("\n");
    return this.systemPromptTemplate.replace('{items}', items);
  }

  // -- CRUD -----------------------------------------------------------------
  async getPage(id: string): Promise<WikiPage | null> {
    return this.db.getById(id);
  }
  async getByTags(tag: string, limit: number = 20): Promise<WikiPage[]> {
    const pages = await this.db.getByTags([tag]);
    return pages.slice(0, limit);
  }
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
    return page;
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
    return updated;
  }
  async deletePage(id: string): Promise<void> {
    await this.db.delete(id);
  }
  async getAllPages(): Promise<WikiPage[]> {
    return this.db.getAll();
  }
  // -- Search ---------------------------------------------------------------

  async search(query: string, limit: number = 5): Promise<WikiPage[]> {
    const pages = await this.db.getAll();
    if (pages.length === 0) return [];
    const results = await this.searcher.search(query, pages, toSearchable, limit);
    return results.map(r => r.item);
  }

  // -- Lifecycle ------------------------------------------------------------

  async dispose(): Promise<void> {
    await this.db.dispose();
  }

}
