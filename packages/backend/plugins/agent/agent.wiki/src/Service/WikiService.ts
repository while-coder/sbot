import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { inject, init } from "scorpio.di";
import { HybridSearcher, IEmbeddingService } from "scorpio.ai";
import { T_WikiSystemPromptTemplate, T_WikiToolDescs, T_WikiCachePath, T_WikiId, WikiPage } from "../shared";
import { IWikiDatabase, isWritableWikiDatabase, IWritableWikiDatabase } from "../Database/IWikiDatabase";
import { IWikiService } from "./IWikiService";
import { WikiToolDescs } from "../Tools/WikiToolProvider";

/** 检索文本：有正文用 标题+正文（写源/缓存命中页），懒加载源未读过的页面退化为标题。 */
const toText = (page: WikiPage): string =>
  page.content?.trim() ? `${page.title}\n\n${page.content}` : page.title;

/**
 * 正文落盘缓存：wiki_read 拉到的正文按 id 一文件存 <cachePath>/content-cache/，
 * 供后续 search 以 标题+正文 命中（懒加载源 getAll 不带正文）。TTL 24h。
 * 裸存正文、以文件 mtime 记写入时间（TTL 判据）；进程内不驻留副本，按 id 现读现写；
 * 重复 read 同 id 覆盖旧文件。
 */
const CONTENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CONTENT_CACHE_DIR = "content-cache";

/** id → djb2 hex（缓存文件名防碰撞后缀）。 */
function hashId(id: string): string {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

export class WikiService implements IWikiService {
  private searcher: HybridSearcher;
  private cachePath: string;

  constructor(
    @inject(IWikiDatabase) private db: IWikiDatabase,
    @inject(T_WikiSystemPromptTemplate) private systemPromptTemplate: string,
    @inject(T_WikiToolDescs) private toolDescs: WikiToolDescs,
    @inject(T_WikiCachePath) cachePath: string,
    @inject(T_WikiId) private wikiId: string,
    @inject(IEmbeddingService, { optional: true }) embeddings?: IEmbeddingService,
  ) {
    this.cachePath = cachePath;
    this.searcher = new HybridSearcher({ cachePath, embeddingModel: embeddings });
    // 旧版单文件全量缓存（content-cache.json）迁移清理，失败（含不存在）静默
    try { fs.unlinkSync(path.join(cachePath, "content-cache.json")); } catch { /* ignore */ }
  }

  @init()
  initialize(): void {}

  /** 本库唯一标识（settings.wikis 的 key），供工具层跨库路由与歧义检测。 */
  getId(): string {
    return this.wikiId;
  }

  getToolDescs(): WikiToolDescs {
    return this.toolDescs;
  }

  async getSystemMessage(query: string): Promise<string | null> {
    const results = await this.search(query, 5);
    if (results.length === 0) return null;

    const items = results.map(r => {
      const tags = r.tags.length > 0 ? ` tags="${r.tags.join(', ')}"` : '';
      return `  <page id="${r.id}" title="${r.title}"${tags} />`;
    }).join("\n");
    // wiki 身份在容器上声明一次，page 不重复携带（省 token；wiki_read 靠容器归属传参）
    const group = `<wiki id="${this.wikiId}">\n${items}\n</wiki>`;
    return this.systemPromptTemplate.replace('{items}', group);
  }

  // -- CRUD -----------------------------------------------------------------
  /** 元数据 + 正文合成完整页面（缓存回写）；仅 savePage 增量更新需要。 */
  private async getPage(id: string): Promise<WikiPage | null> {
    const meta = (await this.db.getAll()).find(p => p.id === id);
    if (!meta) return null;
    const content = await this.db.readContent(id);
    const page: WikiPage = { ...meta, content: content ?? meta.content ?? "" };
    if (page.content) this.writeCachedContent(id, page.content);
    return page;
  }

  async readContent(id: string): Promise<string | null> {
    const content = await this.db.readContent(id);
    if (content) this.writeCachedContent(id, content);
    return content;
  }
  /** 可写数据源访问器：只读源调用写路径时给出明确报错。 */
  private writable(): IWritableWikiDatabase {
    if (!isWritableWikiDatabase(this.db)) {
      throw new Error("wiki source is read-only");
    }
    return this.db;
  }

  async savePage(patch: {
    id?: string;
    title?: string;
    content?: string;
    tags?: string[];
  }): Promise<WikiPage> {
    // 无 id = 新建
    if (!patch.id) {
      if (!patch.title?.trim() || !patch.content?.trim()) {
        throw new Error("title and content are required");
      }
      const now = Date.now();
      const page: WikiPage = {
        id: uuidv4(),
        title: patch.title,
        content: patch.content,
        tags: patch.tags ?? [],
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      await this.writable().insert(page);
      return page;
    }

    // 有 id = 增量更新（未提供的字段保持原值）
    const existing = await this.getPage(patch.id);
    if (!existing) {
      throw new Error(`WikiPage not found: ${patch.id}`);
    }
    const updated: WikiPage = {
      ...existing,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.content !== undefined ? { content: patch.content } : {}),
      ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
      version: existing.version + 1,
      updatedAt: Date.now(),
    };
    await this.writable().update(patch.id, updated);
    return updated;
  }
  async deletePage(id: string): Promise<void> {
    await this.writable().delete(id);
  }
  async getAllPages(): Promise<WikiPage[]> {
    return this.db.getAll();
  }
  // -- Search ---------------------------------------------------------------

  async search(query: string, limit: number = 5): Promise<WikiPage[]> {
    const pages = await this.db.getAll();
    if (pages.length === 0) return [];
    // 缓存只为"正文缺失"的页面服务（如懒加载源）；getAll 自带正文（wiki.local）时完全不碰缓存
    const needsCache = pages.some(p => !p.content?.trim());
    // 缓存目录都不存在（从未 read 过任何页面）→ 全体按未缓存处理，免逐 id stat
    const hasCacheDir = needsCache && fs.existsSync(this.contentCacheDir);
    const merged: WikiPage[] = pages.map(p => {
      if (p.content?.trim()) return p;
      if (hasCacheDir) {
        const cached = this.readCachedContent(p.id);
        if (cached) return { ...p, content: cached };
      }
      return p;
    });
    const results = await this.searcher.search(query, merged, toText, limit);
    return results.map(r => r.item);
  }

  // -- Lifecycle ------------------------------------------------------------

  async dispose(): Promise<void> {
    this.searcher.dispose();
    await this.db.dispose();
  }

  // -- 正文缓存（落盘，进程内不驻留） -----------------------------------------

  private get contentCacheDir(): string {
    return path.join(this.cachePath, CONTENT_CACHE_DIR);
  }

  /**
   * id → 缓存文件路径。id 会拼进文件名，为防路径穿越，非 [a-zA-Z0-9._-] 字符替换为 "_"；
   * 替换过的 id 追加 hash 防碰撞（如 "a/b" 与 "a\b" 同名）。
   */
  private cachedFilePath(id: string): string {
    const safe = id.replace(/[^a-zA-Z0-9._-]/g, "_");
    const name = safe === id ? safe : `${safe}-${hashId(id)}`;
    return path.join(this.contentCacheDir, name);
  }

  /** 按需读单文件；不存在 / 过期（mtime 距今 ≥ 24h）/ 读取失败一律视为未缓存。 */
  private readCachedContent(id: string): string | null {
    try {
      const filePath = this.cachedFilePath(id);
      const mtimeMs = fs.statSync(filePath).mtimeMs;
      if (Date.now() - mtimeMs >= CONTENT_CACHE_TTL_MS) return null;
      return fs.readFileSync(filePath, "utf8");
    } catch {
      return null; // 不存在 / 不可读 → 未缓存
    }
  }

  /** 直接覆盖单文件（per-id 一文件，天然无并发合并问题）。 */
  private writeCachedContent(id: string, content: string): void {
    try {
      fs.mkdirSync(this.contentCacheDir, { recursive: true });
      fs.writeFileSync(this.cachedFilePath(id), content);
    } catch {
      // 缓存写失败不影响读取主流程
    }
  }

}
