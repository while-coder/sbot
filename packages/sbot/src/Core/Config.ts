import os from "os";
import path from "path";
import fs from "fs";
import type { ModelConfig, MCPServers, IModelService, IEmbeddingService, AgentSubNode } from "scorpio.ai";
import { ModelProvider } from "scorpio.ai/Model/types";
import type { EmbeddingConfig } from "scorpio.ai/Embedding/types";
import { EmbeddingProvider } from "scorpio.ai/Embedding/types";
export type { AgentSubNode } from "scorpio.ai";
import { DEFAULT_PORT, SaverType, AgentMode, MemoryMode, SaverConfig, MemoryConfig, WikiConfig, ChannelConfig, type AgentStoreSource, type AgentSourceEntry } from "sbot.commons";
export { DEFAULT_PORT, SaverType, AgentMode, SaverConfig, MemoryConfig, WikiConfig, ChannelConfig } from "sbot.commons";

export const isDev = process.env.NODE_ENV === 'development';
export type { AgentSourceEntry } from "sbot.commons";

/**
 * ModelConfig 的命名扩展（key 为 UUID）
 */
export interface NamedModelConfig extends ModelConfig {
  name?: string;               // 显示名称（可选，便于识别）
}

/**
 * EmbeddingConfig 的命名扩展（key 为 UUID）
 */
export interface NamedEmbeddingConfig extends EmbeddingConfig {
  name?: string;               // 显示名称（可选，便于识别）
}

/**
 * Agent 基础配置（所有模式共用）
 */
export interface BaseAgentEntry {
  name?: string;               // 显示名称（可选，便于识别）
  type: AgentMode;
  model: string;               // 模型 UUID（single 模式为执行模型；react 模式为 Think 编排模型）
  compactModel?: string;       // 对话压缩模型 UUID（可选，不配置则用 model）
  compactPrompt?: string;      // 对话压缩自定义提示词（可选，不配置则用默认）
  systemPrompt?: string;       // 系统提示词（single 模式直接使用；react 模式注入所有子 Agent）
  mcp?: string[] | '*';        // 全局 MCP 服务器过滤列表（对应 mcp.json 中的 key）；"*" = 加载全部
  skills?: string[] | '*';     // 全局 Skills 过滤列表（skill 名称）；"*" = 加载全部
  autoApproveTools?: string[]; // 自动批准的工具列表（无需用户确认）
  autoApproveAllTools?: boolean; // 自动批准所有工具（无需用户确认）
  modelCallTimeout?: number;   // 单次模型调用超时（秒），不设置则不超时
}

/**
 * Single 模式 Agent 配置
 */
export interface SingleAgentEntry extends BaseAgentEntry {
  type: AgentMode.Single;
}

/**
 * ReAct 模式 Agent 配置
 */
export interface ReactAgentEntry extends BaseAgentEntry {
  type: AgentMode.ReAct;
  agents: AgentSubNode[];      // 子 Agent 引用列表（name 字段为 agent UUID）
}

/**
 * Generative 模式 Agent 配置（图片/音频等纯生成式模型，无工具循环）
 */
export interface GenerativeAgentEntry extends BaseAgentEntry {
  type: AgentMode.Generative;
}

/**
 * Agent 配置条目（联合类型）
 */
export type AgentEntry = SingleAgentEntry | ReactAgentEntry | GenerativeAgentEntry;

export interface Settings {
  httpPort?: number;           // HTTP 服务监听端口，默认 5500
  httpUrl?: string;            // HTTP 服务对外访问的根 URL，默认 http://localhost:5500
  autoApproveTools?: string[]; // 全局自动批准的工具列表（无需用户确认）
  autoApproveAllTools?: boolean; // 全局自动批准所有工具（无需用户确认）
  startupCommands?: string[];  // 启动后立即执行的命令行列表，依次同步执行
  checkUpdateTime?: number;    // 下次检查更新的时间戳（ms），0 或 undefined 表示立即检查
  maxImageSize?: number;       // 图片最大尺寸（px），max(width,height) 超过此值时按比例缩小；不设置则不压缩
  models?: Record<string, NamedModelConfig>;
  embeddings?: Record<string, NamedEmbeddingConfig>;
  savers?: Record<string, SaverConfig>;
  memories?: Record<string, MemoryConfig>;
  wikis?: Record<string, WikiConfig>;
  channels?: Record<string, ChannelConfig>;
  plugins?: string[];
  agentSources?: AgentSourceEntry[];
}

// Record<keyof Settings, true> 保证与接口同步：漏写或多写都会编译报错
const SETTINGS_KEYS: ReadonlySet<string> = new Set(Object.keys({
  httpPort: true, httpUrl: true, autoApproveTools: true, autoApproveAllTools: true,
  startupCommands: true, checkUpdateTime: true, maxImageSize: true,
  models: true, embeddings: true, savers: true, memories: true, wikis: true, channels: true,
  plugins: true, agentSources: true,
} satisfies Record<keyof Settings, true>));

/**
 * 检查 agentId 是否合法：不含路径非法字符、不含空格、首尾无特殊字符、非空
 */
export function isValidAgentId(id: string): boolean {
  if (!id) return false;
  if (/[<>:"/\\|?*\x00-\x1f\s]/.test(id)) return false;
  if (/^[-_.]|[-_.]$/.test(id)) return false;
  return true;
}

class Config {
  private _configDir: string;
  private _settings: Settings = {};
  readonly pkg: { version: string; name: string; description: string; releasenote: string };

  constructor() {
    this.pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));

    // 获取用户目录
    const userHome = os.homedir();
    this._configDir = path.join(userHome, isDev ? ".sbot-dev" : ".sbot");

    // 每次启动都生成示例配置文件
    this.createExampleSettings();

    // 加载配置文件
    this.loadSettings();
  }

  /**
   * 获取配置内容
   */
  get settings(): Settings {
    return this._settings;
  }

  /**
   * 根据名称获取模型配置
   * @param name 模型名称（对应 settings.models 中的 key）
   * @returns 模型配置，如果未配置则返回 undefined
   */
  getModel(id: string): ModelConfig | undefined {
    if (!this._settings.models) return undefined;
    return this._settings.models[id.trim()];
  }

  /**
   * 根据名称获取 embedding 配置
   * @param name embedding 名称（对应 settings.embeddings 中的 key）
   * @returns embedding 配置，如果未配置则返回 undefined
   */
  getEmbedding(id: string): EmbeddingConfig | undefined {
    if (!this._settings.embeddings) return undefined;
    return this._settings.embeddings[id.trim()];
  }

  /**
   * 从 ~/.sbot/agents/<id>/ 目录读取单个 Agent 配置
   * 合并 system-prompt.md 和 .store.json
   */
  private _readAgentDir(id: string): (AgentEntry & { id: string; storeSource?: AgentStoreSource }) | null {
    const agentDir = path.join(this._configDir, 'agents', id);
    const agentJsonPath = path.join(agentDir, 'agent.json');
    if (!fs.existsSync(agentJsonPath)) return null;

    try {
      const entry = JSON.parse(fs.readFileSync(agentJsonPath, 'utf-8')) as AgentEntry;

      // 读取 system-prompt.md
      const promptPath = path.join(agentDir, 'system-prompt.md');
      if (fs.existsSync(promptPath)) {
        entry.systemPrompt = fs.readFileSync(promptPath, 'utf-8');
      }

      // 读取 .store.json
      let storeSource: AgentStoreSource | undefined;
      const storePath = path.join(agentDir, '.store.json');
      if (fs.existsSync(storePath)) {
        storeSource = JSON.parse(fs.readFileSync(storePath, 'utf-8'));
      }

      return { ...entry, id, storeSource };
    } catch {
      return null;
    }
  }

  /**
   * 列出所有 Agent 目录配置
   */
  listAgents(): (AgentEntry & { id: string; storeSource?: AgentStoreSource })[] {
    const agentsDir = path.join(this._configDir, 'agents');
    if (!fs.existsSync(agentsDir)) return [];

    const results: (AgentEntry & { id: string; storeSource?: AgentStoreSource })[] = [];
    const entries = fs.readdirSync(agentsDir, { withFileTypes: true });

    for (const dirent of entries) {
      if (!dirent.isDirectory()) continue;
      const agent = this._readAgentDir(dirent.name);
      if (agent) results.push(agent);
    }

    return results.sort((a, b) => a.id.localeCompare(b.id));
  }

  /**
   * 获取 Agent 配置
   */
  getAgent(id: string): AgentEntry & { id: string; storeSource?: AgentStoreSource } {
    const trimmed = id.trim();
    const fromDir = this._readAgentDir(trimmed);
    if (fromDir) return fromDir;
    throw new Error(`Agent config "${id}" not found`);
  }

  /**
   * 保存 Agent 配置到目录
   */
  saveAgent(id: string, entry: any): void {
    const agentDir = this.getConfigPath(`agents/${id}`, true);

    // 提取并分离 systemPrompt
    const { systemPrompt, storeSource, id: _id, ...rest } = entry;

    // 写入 agent.json
    fs.writeFileSync(path.join(agentDir, 'agent.json'), JSON.stringify(rest, null, 2), 'utf-8');

    // 写入或删除 system-prompt.md
    const promptPath = path.join(agentDir, 'system-prompt.md');
    if (systemPrompt) {
      fs.writeFileSync(promptPath, systemPrompt, 'utf-8');
    } else if (fs.existsSync(promptPath)) {
      fs.unlinkSync(promptPath);
    }

    // 写入或删除 .store.json
    const storePath = path.join(agentDir, '.store.json');
    if (storeSource !== undefined) {
      fs.writeFileSync(storePath, JSON.stringify(storeSource, null, 2), 'utf-8');
    } else if (fs.existsSync(storePath)) {
      fs.unlinkSync(storePath);
    }
  }

  /**
   * 删除 Agent 目录
   */
  deleteAgent(id: string): void {
    const agentDir = path.join(this._configDir, 'agents', id);
    fs.rmSync(agentDir, { recursive: true, force: true });
  }

  /**
   * 检查 Agent 目录是否存在
   */
  agentExists(id: string): boolean {
    const agentJsonPath = path.join(this._configDir, 'agents', id, 'agent.json');
    return fs.existsSync(agentJsonPath);
  }

  getSaver(id: string): SaverConfig | undefined {
    if (!this._settings.savers) return undefined;
    return this._settings.savers[id.trim()];
  }

  getMemory(id: string): MemoryConfig | undefined {
    if (!this._settings.memories) return undefined;
    return this._settings.memories[id.trim()];
  }

  getChannel(id: string): ChannelConfig | undefined {
    if (!this._settings.channels) return undefined;
    return this._settings.channels[id.trim()];
  }

  async getModelService(id: string | undefined, throwError = false): Promise<IModelService | undefined> {
    if (!id) {
      if (throwError) throw new Error(`Model config "${id}" not found`);
      return undefined;
    }
    const modelConfig = this.getModel(id);
    if (!modelConfig) {
      if (throwError) throw new Error(`Model config "${id}" not found`);
      return undefined;
    }
    const { ModelServiceFactory } = await import("scorpio.ai/Model");
    return ModelServiceFactory.getModelService(modelConfig);
  }

  async getEmbeddingService(name: string, throwError = false): Promise<IEmbeddingService | undefined> {
    const embeddingConfig = this.getEmbedding(name);
    if (!embeddingConfig) {
      if (throwError) throw new Error(`Embedding config "${name}" not found`);
      return undefined;
    }
    const { EmbeddingServiceFactory } = await import("scorpio.ai/Embedding");
    return EmbeddingServiceFactory.getEmbeddingService(embeddingConfig);
  }

  /**
   * 加载配置文件
   */
  private loadSettings(): void {
    const settingsPath = this.getConfigPath("settings.json");

    try {
      if (fs.existsSync(settingsPath)) {
        const content = fs.readFileSync(settingsPath, "utf-8");
        const raw = JSON.parse(content);
        let dirty = false;
        for (const key of Object.keys(raw)) {
          if (!SETTINGS_KEYS.has(key)) { delete raw[key]; dirty = true; }
        }
        this._settings = raw;
        if (dirty) this.saveSettings();
      } else {
        // 创建默认配置文件
        this.createDefaultSettings(settingsPath);
      }
    } catch (error) {
      this._settings = {};
    }
  }

  /**
   * 获取 MCP 服务器配置（每次都实时读取 mcp.json 文件）
   */
  getGlobalMcpServers(): MCPServers {
    const mcpConfigPath = this.getConfigPath("mcp.json");

    try {
      if (fs.existsSync(mcpConfigPath)) {
        const content = fs.readFileSync(mcpConfigPath, "utf-8");
        const parsed = JSON.parse(content);
        // 支持 mcpServers 或直接的服务器配置
        return (parsed.mcpServers || parsed) as MCPServers;
      }
    } catch (error) {
      // 读取失败时返回空对象
    }

    return {};
  }

  /**
   * 保存 MCP 服务器配置到 mcp.json
   */
  saveMcpServers(mcpServers: MCPServers): void {
    const mcpConfigPath = this.getConfigPath("mcp.json");
    fs.writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers }, null, 2), "utf-8");
  }
  saveAgentMcpServers(agentName: string, mcpServers: MCPServers): void {
    const mcpConfigPath = this.getConfigPath(`agents/${agentName}/mcp.json`);
    fs.writeFileSync(mcpConfigPath, JSON.stringify({ mcpServers }, null, 2), "utf-8");
  }


  /**
   * 每次启动时生成示例配置文件 settings.json.example
   */
  private createExampleSettings(): void {
    const examplePath = this.getConfigPath("settings.json.example");

    const M1 = "10000000-0000-0000-0000-000000000001";
    const M2 = "10000000-0000-0000-0000-000000000002";
    const E1 = "20000000-0000-0000-0000-000000000001";
    const S1 = "30000000-0000-0000-0000-000000000001";
    const ME1 = "40000000-0000-0000-0000-000000000001";

    const example: Settings = {
      startupCommands: ["echo 'sbot initializing...'"],
      savers: {
        [S1]: { name: "default", type: SaverType.Sqlite, share: false },
      },
      memories: {
        [ME1]: { name: "default", mode: MemoryMode.HumanAndAI, maxAgeDays: 90, embedding: E1, extractor: M1, compressor: M1, share: false },
      },
      models: {
        [M1]: { name: "openai-gpt4",   provider: ModelProvider.OpenAI,     apiKey: "your-api-key", baseURL: "https://api.openai.com/v1",               model: "gpt-4" },
        [M2]: { name: "claude",         provider: ModelProvider.Anthropic,   apiKey: "your-api-key", baseURL: "https://api.anthropic.com",               model: "claude-3-opus-20240229" },
      },
      embeddings: {
        [E1]: { name: "openai-ada",     provider: EmbeddingProvider.OpenAI, apiKey: "your-api-key", baseURL: "https://api.openai.com/v1",               model: "text-embedding-ada-002" },
      },
    };

    try {
      fs.writeFileSync(examplePath, JSON.stringify(example, null, 2), "utf-8");
    } catch (error) {
      // 忽略错误
    }
  }



  /**
   * 创建默认配置文件
   */
  private createDefaultSettings(settingsPath: string): void {
    try {
      this._settings = {};
      fs.writeFileSync(settingsPath, JSON.stringify(this._settings, null, 2), "utf-8");
    } catch (error) {
      // 忽略错误
    }
  }

  /**
   * 保存当前配置到 settings.json
   */
  saveSettings(): void {
    const settingsPath = this.getConfigPath("settings.json");
    fs.writeFileSync(settingsPath, JSON.stringify(this._settings, null, 2), "utf-8");
  }

  /**
   * 重新加载配置文件
   */
  reloadSettings(): void {
    this.loadSettings();
  }

  /**
   * 获取配置目录下的文件或目录路径，自动确保父目录存在
   * @param pathSegment 文件名或路径（支持多层目录，如 "logs/app.log" 或 "cache/images/thumb.png"）
   * @param isDirectory 是否为目录路径（默认 false，即文件路径）
   * @returns 完整的文件或目录路径
   *
   * @example
   * // 获取文件路径，自动创建父目录
   * config.getConfigPath("settings.json")  // ~/.sbot/settings.json
   * config.getConfigPath("logs/app.log")   // ~/.sbot/logs/app.log (自动创建 logs 目录)
   *
   * // 获取目录路径，自动创建该目录
   * config.getConfigPath("cache", true)  // ~/.sbot/cache (自动创建)
   * config.getConfigPath("data/images", true)  // ~/.sbot/data/images (自动创建多层目录)
   */
  getConfigPath(pathSegment: string, isDirectory: boolean = false): string {
    const fullPath = path.join(this._configDir, pathSegment);

    // 确定需要创建的目录
    // 如果是目录，则创建该目录；如果是文件，则创建其父目录
    const dirToEnsure = isDirectory ? fullPath : path.dirname(fullPath);

    // 确保目录存在
    if (!fs.existsSync(dirToEnsure)) {
      fs.mkdirSync(dirToEnsure, { recursive: true });
    }

    return fullPath;
  }

  setCheckUpdateTime(time: number): void {
    this._settings.checkUpdateTime = time;
    this.saveSettings();
  }

  getHttpPort(): number {
    return this._settings.httpPort ?? DEFAULT_PORT;
  }

  setHttpPort(port: number): void {
    this._settings.httpPort = port;
    this.saveSettings();
  }

  getHttpUrl(): string {
    return (this._settings.httpUrl ?? `http://localhost:${this.getHttpPort()}`).replace(/\/$/, '');
  }

  getSkillsPath() {
    return this.getConfigPath("skills", true)
  }
  getAgentSkillsPath(agentName: string) {
    return this.getConfigPath(`agents/${agentName}/skills`, true)
  }
  getAgentMcpServers(agentName: string): MCPServers {
    const mcpConfigPath = this.getConfigPath(`agents/${agentName}/mcp.json`);
    try {
      if (fs.existsSync(mcpConfigPath)) {
        const content = fs.readFileSync(mcpConfigPath, "utf-8");
        const parsed = JSON.parse(content);
        return (parsed.mcpServers || parsed) as MCPServers;
      }
    } catch (error) {
      // 读取失败时返回空对象
    }
    return {};
  }
  getSaverDBDir(saverName: string) {
    return this.getConfigPath(`savers/${saverName}`, true)
  }
  getSaverDBPath(saverId: string, saverThreadId: string, ext: string) {
    return this.getConfigPath(`savers/${saverId}/${saverThreadId}${ext}`)
  }
  getMemoryDBDir(memoryId: string) {
    return this.getConfigPath(`memories/${memoryId}`, true)
  }
  getMemoryDBPath(memoryId: string, memoryThreadId: string) {
    return this.getConfigPath(`memories/${memoryId}/${memoryThreadId}.db`)
  }

  getWiki(id: string): WikiConfig | undefined {
    return this._settings.wikis?.[id.trim()];
  }
  getWikiDBDir(wikiId: string) {
    return this.getConfigPath(`wiki/${wikiId}`, true)
  }
  getWikiDBPath(wikiId: string, threadId: string) {
    return this.getConfigPath(`wiki/${wikiId}/${threadId}`, true)
  }

}

export const config = new Config();
