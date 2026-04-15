import { v4 as uuidv4 } from "uuid";
import { inject } from "../../Core";
import { T_WikiAutoExtract } from "../../Core";
import { ILoggerService, ILogger } from "../../Logger";
import { IWikiDatabase } from "../Database/IWikiDatabase";
import { IWikiExtractor } from "../Extractor/IWikiExtractor";
import { WikiPage, WikiSearchResult, WikiPageSource } from "../Types";
import { IWikiService } from "./IWikiService";

export class WikiService implements IWikiService {
  private logger?: ILogger;
  private autoExtract: boolean;

  constructor(
    @inject(IWikiDatabase) private db: IWikiDatabase,
    @inject(IWikiExtractor) private extractor: IWikiExtractor,
    @inject(T_WikiAutoExtract, { optional: true }) autoExtract?: boolean,
    @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
  ) {
    this.logger = loggerService?.getLogger("WikiService");
    this.autoExtract = autoExtract !== false; // default true
  }

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

  // -- Conversation auto-extraction -----------------------------------------

  async extractFromConversation(
    userMessage: string,
    assistantMessages: string[] = [],
  ): Promise<WikiPage[]> {
    if (!this.autoExtract) return [];
    if (!this.extractor) return [];

    try {
      const allPages = await this.db.getAll();
      const titles = allPages.map(p => p.title);

      const extracted = await this.extractor.extract(userMessage, assistantMessages, titles);
      const result: WikiPage[] = [];

      for (const item of extracted) {
        if (item.shouldMergeWith) {
          const existing = await this.db.getByTitle(item.shouldMergeWith);
          if (existing) {
            const mergedContent = existing.content + "\n\n" + item.content;
            const mergedTags = Array.from(new Set([...existing.tags, ...item.tags]));
            const updated = await this.updatePage(existing.id, {
              content: mergedContent,
              tags: mergedTags,
            });
            result.push(updated);
            continue;
          }
        }

        const page = await this.createPage(
          item.title,
          item.content,
          item.tags,
        );
        // Override source to 'conversation' for extracted pages
        const conversationPage: WikiPage = { ...page, source: "conversation" as WikiPageSource };
        await this.db.update(conversationPage.id, { source: "conversation" });
        result.push(conversationPage);
      }

      return result;
    } catch (error: any) {
      this.logger?.error(`Failed to extract from conversation: ${error.message}`);
      return [];
    }
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
