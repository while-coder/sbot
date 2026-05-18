import { v4 as uuidv4 } from "uuid";
import { inject } from "../../Core";
import { IWikiDatabase } from "../Database/IWikiDatabase";
import { WikiPage, WikiSearchResult, WikiPageSource } from "../Types";
import { IWikiService } from "./IWikiService";

export class WikiService implements IWikiService {
  constructor(
    @inject(IWikiDatabase) private db: IWikiDatabase,
  ) {}

  // -- CRUD -----------------------------------------------------------------

  async createPage(
    title: string,
    content: string,
    tags: string[] = [],
    links: string[] = [],
  ): Promise<WikiPage> {
    const id = uuidv4();
    const now = Date.now();

    const page: WikiPage = {
      id,
      title,
      content,
      tags,
      links,
      metadata: {},
      version: 1,
      source: "manual" as WikiPageSource,
      createdAt: now,
      updatedAt: now,
    };

    await this.db.insert(page);
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
    updates: Partial<Pick<WikiPage, "title" | "content" | "tags" | "links">>,
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

  // -- Search ---------------------------------------------------------------

  async search(query: string, limit: number = 5): Promise<WikiSearchResult[]> {
    const pages = await this.db.searchByText(query, limit);
    return pages.map(page => ({
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
