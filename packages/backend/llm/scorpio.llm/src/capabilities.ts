import fs from "fs";
import os from "os";
import path from "path";

/**
 * 模型能力解析（当前只关心视觉输入）。
 *
 * 数据源参考 opencode 的方案：models.dev 社区目录（走 opencode 官方镜像，原站
 * https://models.dev 国内常不可达），一份数据覆盖所有主流 provider/model 的能力声明；解析优先级：
 *
 *   1. 用户显式配置  ModelConfig.vision（最高，覆盖一切）
 *   2. models.dev    按模型名匹配 attachment / modalities.input
 *   3. 目录可用但未收录 → 保守 false（降级为文本说明，提示可配 vision: true）
 *     目录完全不可用   → true（维持本功能引入前的行为，不因网络问题惩罚所有模型）
 *
 * 目录拉取失败时兜底顺序：磁盘缓存（过期也用）→ 空目录（目录不可用分支）。
 * 不内置快照：数据会过期，且降级路径本身就是优雅的（文本说明而非报错）。
 */

// models.dev 官方域名在国内网络常不可达，opencode 官方镜像的数据与结构完全一致
const MODELS_DEV_URL = "https://models.opencode.ai/api.json";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

interface ModelsDevModel {
  attachment?: boolean;
  modalities?: { input?: string[]; output?: string[] };
  [key: string]: any;
}

type ModelsDevCatalog = Record<string, { models?: Record<string, ModelsDevModel> }>;

interface CatalogState {
  catalog: ModelsDevCatalog;
  /** 目录是否成功加载（网络/缓存任一来源）；false 表示目录完全不可用。 */
  loaded: boolean;
}

let catalogPromise: Promise<CatalogState> | undefined;

function cacheFilePath(): string {
  return path.join(os.homedir(), ".sbot", "cache", "models-dev.json");
}

function readDiskCache(): { catalog: ModelsDevCatalog; fetchedAt: number } | undefined {
  try {
    const raw = fs.readFileSync(cacheFilePath(), "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.fetchedAt === "number" && parsed.catalog && typeof parsed.catalog === "object") {
      return parsed;
    }
  } catch {
    // 缓存不可读（不存在/损坏）视为无缓存
  }
  return undefined;
}

function writeDiskCache(catalog: ModelsDevCatalog): void {
  try {
    fs.mkdirSync(path.dirname(cacheFilePath()), { recursive: true });
    fs.writeFileSync(cacheFilePath(), JSON.stringify({ fetchedAt: Date.now(), catalog }), "utf-8");
  } catch {
    // 缓存写失败不影响功能，下次再试
  }
}

async function fetchCatalog(): Promise<ModelsDevCatalog> {
  const response = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`models.dev responded ${response.status}`);
  return response.json() as Promise<ModelsDevCatalog>;
}

function getCatalogState(): Promise<CatalogState> {
  catalogPromise ??= (async () => {
    const cached = readDiskCache();
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return { catalog: cached.catalog, loaded: true };
    try {
      const catalog = await fetchCatalog();
      writeDiskCache(catalog);
      return { catalog, loaded: true };
    } catch {
      // 拉取失败：磁盘缓存过期也用；完全没有则目录不可用（能力解析退回旧行为）
      if (cached) return { catalog: cached.catalog, loaded: true };
      console.warn(`[scorpio.llm] models.dev 目录拉取失败（${MODELS_DEV_URL}），视觉能力按"未降级"处理`);
      return { catalog: {}, loaded: false };
    }
  })();
  return catalogPromise;
}

function modelSupportsImage(model: ModelsDevModel): boolean {
  return model.modalities?.input?.includes("image") ?? model.attachment ?? false;
}

function lastSegment(modelId: string): string {
  // 中转网关常用 "provider/model"、区域前缀（us.xxx）等命名，取最后一段做模糊匹配
  const segments = modelId.split(/[/:.]/).filter(Boolean);
  return segments[segments.length - 1].toLowerCase();
}

/**
 * 在 models.dev 目录中查询模型的视觉能力；未匹配到返回 undefined。
 * 匹配策略：provider 内精确 → 跨 provider 精确 → 忽略前缀的后缀匹配。
 * 多个 provider 同名模型结论冲突时同样返回 undefined（无法确定）。
 */
async function lookupVisionInCatalog(modelId: string, providerId?: string): Promise<{ state: CatalogState; vision?: boolean }> {
  const state = await getCatalogState();
  const catalog = state.catalog;
  const id = modelId.toLowerCase();
  const tail = lastSegment(modelId);

  const provider = providerId ? catalog[providerId] : undefined;
  const inProvider = provider?.models?.[modelId] ?? provider?.models?.[id];
  if (inProvider) return { state, vision: modelSupportsImage(inProvider) };

  let exact: boolean | undefined;
  for (const entry of Object.values(catalog)) {
    const model = entry.models?.[modelId] ?? entry.models?.[id];
    if (model) {
      const supports = modelSupportsImage(model);
      if (exact === undefined) exact = supports;
      // 多个 provider 都有同名模型且结论冲突时无法确定，走默认分支
      else if (exact !== supports) return { state };
    }
  }
  if (exact !== undefined) return { state, vision: exact };

  let suffix: boolean | undefined;
  for (const entry of Object.values(catalog)) {
    for (const [key, model] of Object.entries(entry.models ?? {})) {
      if (lastSegment(key) !== tail) continue;
      const supports = modelSupportsImage(model);
      if (suffix === undefined) suffix = supports;
      else if (suffix !== supports) return { state };
    }
  }
  return suffix === undefined ? { state } : { state, vision: suffix };
}

/**
 * 解析模型的视觉输入支持：
 * 显式配置 > models.dev 目录 > 目录可用未收录为 false / 目录不可用为 true（维持旧行为）。
 */
export async function resolveVisionSupport(config: { model: string; provider?: string; vision?: boolean }): Promise<boolean> {
  if (config.vision !== undefined) return config.vision;
  const { state, vision } = await lookupVisionInCatalog(config.model, config.provider);
  if (vision !== undefined) return vision;
  return !state.loaded;
}
