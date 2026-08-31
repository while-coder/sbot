import type { IWikiDatabase, WikiPage } from "wiki.base";

export interface DriveConfig {
  /** 作为 wiki 目录的 Drive 文件夹 ID */
  folderId?: string;
  /** 服务账号凭据：JSON 内容，或凭据文件的路径 */
  auth?: string;
}

const LIST_TTL_MS = 60_000;       // 文件清单缓存 60s
const CONTENT_TTL_MS = 300_000;   // 单文件内容缓存 5min
const FOLDER_MIME = "application/vnd.google-apps.folder";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive";

/** Google 原生文档类型 → 导出 MIME（取文本/Markdown 表示） */
const EXPORT_MIME: Record<string, string> = {
  "application/vnd.google-apps.document": "text/markdown",
  "application/vnd.google-apps.spreadsheet": "text/csv",
  "application/vnd.google-apps.presentation": "text/plain",
};

/** 可直接以 alt=media 当文本读取的 MIME */
function isTextMime(mime: string | undefined): boolean {
  if (!mime) return false;
  return (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/javascript" ||
    mime === "application/x-yaml" ||
    mime === "application/yaml" ||
    mime === "application/markdown"
  );
}

/**
 * Google Drive 数据源：把一个 Drive 文件夹当作只读 wiki 目录。
 * - getAll() 只列文件 metadata（懒加载，content 留空），用于目录/搜索。
 * - readContent() 才真正下载/导出全文，原生 Docs/Sheets/Slides 导出为 Markdown/CSV/文本；
 *   读过的文件由 WikiService 以 标题+正文 参与后续检索。
 * - 文件清单与单文件内容各自 TTL 缓存，避免打爆 Drive API 配额。
 */
export class WikiDriveDatabase implements IWikiDatabase {
  private drive: any;
  private listCache?: { at: number; pages: WikiPage[] };
  private contentCache = new Map<string, { at: number; content: string }>();

  constructor(
    private readonly cfg: DriveConfig,
    private readonly logger: any,
    _cachePath: string,
  ) {
    if (!cfg.folderId?.trim()) {
      throw new Error("wiki.gdrive: folderId is required");
    }
    if (!cfg.auth?.trim()) {
      throw new Error("wiki.gdrive: auth is required (service account JSON)");
    }
  }

  // --- 查询 ---

  async readContent(id: string): Promise<string | null> {
    const drive = this.getDrive();
    let mime: string | undefined;
    try {
      const res = await drive.files.get({
        fileId: id,
        fields: "id, mimeType",
        supportsAllDrives: true,
      });
      mime = res.data.mimeType;
    } catch (e: any) {
      if (e?.code === 404 || e?.response?.status === 404) return null;
      throw e;
    }

    const cached = this.contentCache.get(id);
    if (cached && Date.now() - cached.at < CONTENT_TTL_MS) {
      return cached.content;
    }
    const content = await this.fetchContent(drive, id, mime);
    this.contentCache.set(id, { at: Date.now(), content });
    return content;
  }

  async getAll(): Promise<WikiPage[]> {
    if (this.listCache && Date.now() - this.listCache.at < LIST_TTL_MS) {
      return this.listCache.pages;
    }
    const drive = this.getDrive();
    const pages: WikiPage[] = [];
    let pageToken: string | undefined;
    do {
      const res = await drive.files.list({
        q: `'${this.cfg.folderId}' in parents and trashed = false`,
        fields: "nextPageToken, files(id, name, mimeType, createdTime, modifiedTime)",
        pageSize: 1000,
        pageToken,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      for (const f of res.data.files ?? []) {
        if (f.mimeType === FOLDER_MIME) continue; // 跳过子文件夹
        pages.push(this.toPage(f, "")); // 列目录不下载内容
      }
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    this.listCache = { at: Date.now(), pages };
    return pages;
  }

  // --- 生命周期 ---

  async dispose(): Promise<void> {
    this.listCache = undefined;
    this.contentCache.clear();
  }

  // --- Private ---

  private toPage(f: any, content: string): WikiPage {
    return {
      id: String(f.id),
      title: String(f.name ?? f.id),
      content,
      tags: [],
      version: 1,
      createdAt: f.createdTime ? Date.parse(f.createdTime) : 0,
      updatedAt: f.modifiedTime ? Date.parse(f.modifiedTime) : 0,
    };
  }

  private async fetchContent(drive: any, id: string, mime: string | undefined): Promise<string> {
    try {
      const exportMime = mime ? EXPORT_MIME[mime] : undefined;
      if (exportMime) {
        const res = await drive.files.export({ fileId: id, mimeType: exportMime }, { responseType: "text" });
        return typeof res.data === "string" ? res.data : String(res.data ?? "");
      }
      if (mime?.startsWith("application/vnd.google-apps.")) {
        return `(Unsupported Google native type: ${mime})`;
      }
      if (isTextMime(mime)) {
        const res = await drive.files.get(
          { fileId: id, alt: "media", supportsAllDrives: true },
          { responseType: "text" },
        );
        return typeof res.data === "string" ? res.data : String(res.data ?? "");
      }
      return `(Binary file, not readable as text: ${mime ?? "unknown"})`;
    } catch (e: any) {
      this.logger?.warn?.(`wiki.gdrive: fetch content failed for ${id}: ${e?.message ?? e}`);
      return `(Failed to read file content: ${e?.message ?? e})`;
    }
  }

  private getDrive(): any {
    if (this.drive) return this.drive;

    const gapi = require("@googleapis/drive");
    let creds: any;
    try {
      creds = JSON.parse(this.cfg.auth ?? "");
    } catch {
      throw new Error("wiki.gdrive: auth must be a valid service account JSON string");
    }
    if (!creds || typeof creds !== "object" || Array.isArray(creds)) {
      throw new Error("wiki.gdrive: auth must be a service account JSON object");
    }
    const auth = new gapi.auth.GoogleAuth({ credentials: creds, scopes: [DRIVE_SCOPE] });

    this.drive = gapi.drive({ version: "v3", auth });
    return this.drive;
  }
}
