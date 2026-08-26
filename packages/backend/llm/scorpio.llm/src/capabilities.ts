import fs from "fs";
import os from "os";
import path from "path";

/**
 * 模型能力与限制解析（models.dev 社区目录，参考 opencode 的方案）。
 *
 * 一份数据覆盖所有主流 provider/model 的能力声明，字段包括：
 * vision（attachment/modalities）、tool_call、reasoning、temperature、
 * structured_output、limit（context/output）、cost（每百万 token 价格）。
 *
 * 数据加载（stale-while-revalidate，调用方零网络延迟）：
 *   包内随附一份快照（src/assets/models-dev.snapshot.json，与线上原始数据一致），
 *   读取优先级：内存 → 磁盘缓存（~/.sbot/cache/models-dev.json）→ 内置快照，
 *   命中即同步返回；数据过期（超过 TTL）时后台拉取最新数据，成功后覆盖
 *   磁盘缓存与内存（下次调用生效），失败则继续用本地数据。
 *
 * 解析优先级（按字段独立生效）：
 *   1. 用户显式声明  ModelConfig.llmInfo 对应字段（vision / toolCall / contextWindow / maxOutputTokens）
 *   2. models.dev    Provider 内完整 ID 精确匹配，随后跨 Provider 按完整 ID 精确匹配
 *   3. 默认值        各字段独立定义：
 *       vision       目录可用未收录 → false；目录不可用 → true（维持旧行为）
 *       toolCall     未知 → true（误判 400 可见、可配 toolCall 修正；
 *                    静默跳过工具绑定更危险，故已知 false 才跳过）
 *       其余能力     未知 → 不干预
 */

// models.dev 官方域名在国内网络常不可达，opencode 官方镜像的数据与结构完全一致
const MODELS_DEV_URL = "https://models.opencode.ai/api.json";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** 拉取失败后的退避间隔，避免网络不通时每次调用都发起请求。 */
const RETRY_BACKOFF_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

interface ModelsDevModel {
  attachment?: boolean;
  tool_call?: boolean;
  reasoning?: boolean;
  temperature?: boolean;
  structured_output?: boolean;
  modalities?: { input?: string[]; output?: string[] };
  limit?: { context?: number; input?: number; output?: number };
  cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
  last_updated?: string;
  [key: string]: any;
}

type ModelsDevCatalog = Record<string, { models?: Record<string, ModelsDevModel> }>;

/**
 * 模型能力与限制。完整值由 getLLMInfo 解析返回；Partial<LLMInfo> 用作
 * ModelConfig.llmInfo 显式声明（只配需要覆盖目录的字段）。
 */
export interface LLMInfo {
  vision: boolean;
  toolCall: boolean;
  reasoning: boolean;
  temperature: boolean;
  structuredOutput: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  /** 每百万 token 价格（美元）。 */
  cost?: { input: number; output: number };
  /** 目录条目最后更新时间（ISO 日期；多家来源不一致时缺失）。 */
  lastUpdated?: string;
  /** 数据是否来自 models.dev 目录（false 时均为默认值）。 */
  fromCatalog: boolean;
}

let memoryCatalog: ModelsDevCatalog | undefined;
let memoryFetchedAt = 0;
let refreshPromise: Promise<void> | undefined;
let lastRefreshAttempt = 0;

function cacheFilePath(): string {
  return path.join(os.homedir(), ".sbot", "cache", "models-dev.json");
}

/**
 * 读取本地目录：磁盘缓存优先，不存在/损坏时退回内置快照。
 * fetchedAt = 0 表示来自内置快照（始终视为过期，触发后台刷新）。
 */
function readLocalCatalog(): { catalog: ModelsDevCatalog; fetchedAt: number } | undefined {
  try {
    const raw = fs.readFileSync(cacheFilePath(), "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.fetchedAt === "number" && parsed.catalog && typeof parsed.catalog === "object") {
      return parsed;
    }
  } catch {
    // 缓存不可读，退回内置快照
  }
  try {
    const raw = fs.readFileSync(path.join(__dirname, "assets", "models-dev.snapshot.json"), "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") return { catalog: parsed as ModelsDevCatalog, fetchedAt: 0 };
  } catch {
    // 快照也缺失（构建产物不完整）：目录不可用
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

/** 同步加载本地目录到内存（不发网络请求）；返回目录是否可用。 */
function loadLocalCatalog(): boolean {
  if (memoryCatalog) return true;
  const local = readLocalCatalog();
  if (!local) return false;
  memoryCatalog = local.catalog;
  memoryFetchedAt = local.fetchedAt;
  return true;
}

/**
 * 数据过期时后台拉取最新目录并覆盖本地（不阻塞调用方）。
 * 同一时刻只发一次请求；拉取失败保留本地数据，退避后重试。
 */
function refreshInBackground(): void {
  if (memoryCatalog && Date.now() - memoryFetchedAt < CACHE_TTL_MS) return;
  if (Date.now() - lastRefreshAttempt < RETRY_BACKOFF_MS) return;
  lastRefreshAttempt = Date.now();
  refreshPromise ??= fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    .then(async response => {
      if (!response.ok) throw new Error(`models.dev responded ${response.status}`);
      const catalog = (await response.json()) as ModelsDevCatalog;
      writeDiskCache(catalog);
      memoryCatalog = catalog;
      memoryFetchedAt = Date.now();
    })
    .catch(() => {
      if (!memoryCatalog) {
        console.warn(`[scorpio.llm] models.dev 目录拉取失败（${MODELS_DEV_URL}），视觉能力按"未降级"处理`);
      }
    })
    .finally(() => {
      refreshPromise = undefined;
    });
}

function extractInfo(model: ModelsDevModel): Partial<LLMInfo> {
  return {
    vision: model.modalities?.input?.includes("image") ?? model.attachment ?? false,
    toolCall: model.tool_call ?? false,
    reasoning: model.reasoning ?? false,
    temperature: model.temperature ?? true,
    structuredOutput: model.structured_output ?? false,
    contextWindow: model.limit?.context,
    maxOutputTokens: model.limit?.output,
    cost: model.cost?.input != null && model.cost?.output != null
      ? { input: model.cost.input, output: model.cost.output }
      : undefined,
    lastUpdated: model.last_updated,
  };
}

/**
 * 在目录中按完整模型 ID 精确查询能力；未匹配到返回 undefined。
 * 优先当前 Provider；若当前 Provider 未收录，则允许同名模型跨 Provider 精确回退。
 * 不按模型名后缀猜测，避免兼容网关/输入未完成时命中无关条目。
 */
function lookupCatalogInfo(catalog: ModelsDevCatalog, modelId: string, providerId?: string): Partial<LLMInfo> | undefined {
  const provider = providerId ? catalog[providerId] : undefined;
  const inProvider = provider?.models?.[modelId] ?? provider?.models?.[modelId.toLowerCase()];
  if (inProvider) return extractInfo(inProvider);

  const matches: Partial<LLMInfo>[] = [];
  for (const entry of Object.values(catalog)) {
    const model = entry.models?.[modelId] ?? entry.models?.[modelId.toLowerCase()];
    if (model) matches.push(extractInfo(model));
  }
  if (matches.length === 0) return undefined;

  // 同名模型在不同网关的能力通常一致；价格/限制可能不同，冲突时不猜测。
  const agree = <T>(pick: (info: Partial<LLMInfo>) => T | undefined): T | undefined => {
    const values = matches.map(pick).filter(v => v !== undefined);
    if (values.length === 0) return undefined;
    return values.every(v => JSON.stringify(v) === JSON.stringify(values[0])) ? values[0] : undefined;
  };
  return {
    vision: agree(i => i.vision),
    toolCall: agree(i => i.toolCall),
    reasoning: agree(i => i.reasoning),
    temperature: agree(i => i.temperature),
    structuredOutput: agree(i => i.structuredOutput),
    contextWindow: agree(i => i.contextWindow),
    maxOutputTokens: agree(i => i.maxOutputTokens),
    cost: agree(i => i.cost),
    lastUpdated: agree(i => i.lastUpdated),
  };
}

/**
 * 解析模型能力与限制（同步，无网络延迟）。
 * 显式声明（override，即 ModelConfig.llmInfo）优先于目录，目录数据由内部按 TTL 后台刷新。
 */
export function getLLMInfo(model: string, provider?: string, override?: Partial<LLMInfo>): LLMInfo {
  const hasLocal = loadLocalCatalog();
  refreshInBackground();
  const info = memoryCatalog ? lookupCatalogInfo(memoryCatalog, model, provider) : undefined;
  return {
    vision: override?.vision ?? info?.vision ?? (hasLocal ? false : true),
    toolCall: override?.toolCall ?? info?.toolCall ?? true,
    reasoning: info?.reasoning ?? false,
    temperature: info?.temperature ?? true,
    structuredOutput: info?.structuredOutput ?? false,
    contextWindow: override?.contextWindow ?? info?.contextWindow,
    maxOutputTokens: override?.maxOutputTokens ?? info?.maxOutputTokens,
    cost: info?.cost,
    lastUpdated: info?.lastUpdated,
    fromCatalog: info !== undefined,
  };
}
