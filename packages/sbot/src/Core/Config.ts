import os from "os";
import path from "path";
import fs from "fs";
import { ModelConfig, ModelProvider, EmbeddingConfig, EmbeddingProvider, MCPServers, IModelService, IEmbeddingService, ModelServiceFactory, EmbeddingServiceFactory, type AgentSubNode } from "scorpio.ai";
export type { AgentSubNode } from "scorpio.ai";
import { DEFAULT_PORT, SaverType, AgentMode, MemoryMode, SaverConfig, MemoryConfig, WikiConfig, ChannelConfig, type AgentStoreSource } from "sbot.commons";
export { DEFAULT_PORT, SaverType, AgentMode, ChannelType, SaverConfig, MemoryConfig, WikiConfig, ChannelConfig } from "sbot.commons";

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
  systemPrompt?: string;       // 系统提示词（single 模式直接使用；react 模式注入所有子 Agent）
  mcp?: string[] | '*';        // 全局 MCP 服务器过滤列表（对应 mcp.json 中的 key）；"*" = 加载全部
  skills?: string[] | '*';     // 全局 Skills 过滤列表（skill 名称）；"*" = 加载全部
  autoApproveTools?: string[]; // 自动批准的工具列表（无需用户确认）
  autoApproveAllTools?: boolean; // 自动批准所有工具（无需用户确认）
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
 * Agent 配置条目（联合类型）
 */
export type AgentEntry = SingleAgentEntry | ReactAgentEntry;

export interface Settings {
  httpPort?: number;           // HTTP 服务监听端口，默认 5500
  httpUrl?: string;            // HTTP 服务对外访问的根 URL，默认 http://localhost:5500
  autoApproveTools?: string[]; // 全局自动批准的工具列表（无需用户确认）
  autoApproveAllTools?: boolean; // 全局自动批准所有工具（无需用户确认）
  startupCommands?: string[];  // 启动后立即执行的命令行列表，依次同步执行
  checkUpdateTime?: number;    // 下次检查更新的时间戳（ms），0 或 undefined 表示立即检查
  models?: Record<string, NamedModelConfig>;
  embeddings?: Record<string, NamedEmbeddingConfig>;
  savers?: Record<string, SaverConfig>;
  memories?: Record<string, MemoryConfig>;
  wikis?: Record<string, WikiConfig>;
  agents?: Record<string, AgentEntry>;
  channels?: Record<string, ChannelConfig>;
  plugins?: string[];
}

/**
 * 将名称转换为合法的目录 ID
 */
export function sanitizeId(name: string): string {
  let id = name
    .toLowerCase()
    .replace(/[\s_]+/g, '-')       // 空格和下划线替换为连字符
    .replace(/[^a-z0-9\-\.]/g, '') // 只保留 a-z 0-9 - .
    .replace(/^-+|-+$/g, '');      // 去除首尾连字符
  return id || 'agent';
}

class Config {
  private _configDir: string;
  private _settings: Settings = {};
  private _migrationMap: Record<string, string> | null = null;
  readonly pkg: { version: string; name: string; description: string; releasenote: string };

  constructor() {
    this.pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../../package.json'), 'utf8'));

    // 获取用户目录
    const userHome = os.homedir();
    this._configDir = path.join(userHome, ".sbot");

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
   * 获取 Agent 配置（目录优先，兼容 settings.json 旧格式）
   */
  getAgent(id: string): AgentEntry & { id: string; storeSource?: AgentStoreSource } {
    const trimmed = id.trim();

    // 1. 尝试从目录读取（新方式）
    const fromDir = this._readAgentDir(trimmed);
    if (fromDir) return fromDir;

    // 2. 兼容旧格式：从 settings.json 中读取
    const fromSettings = this._settings.agents?.[trimmed];
    if (fromSettings) return { ...fromSettings, id: fromSettings.name || trimmed };

    // 3. 尝试 UUID 迁移映射
    const resolved = this.resolveAgentRef(trimmed);
    if (resolved !== trimmed) {
      const fromResolved = this._readAgentDir(resolved);
      if (fromResolved) return fromResolved;
    }

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

  /**
   * 解析 Agent 引用（支持 UUID 到别名的迁移映射）
   */
  resolveAgentRef(ref: string): string {
    // UUID 格式：包含连字符且长度为 36
    if (ref.length === 36 && ref.includes('-')) {
      const mapPath = path.join(this._configDir, '.migration-map.json');
      if (fs.existsSync(mapPath)) {
        if (!this._migrationMap) {
          try {
            this._migrationMap = JSON.parse(fs.readFileSync(mapPath, 'utf-8'));
          } catch {
            this._migrationMap = {};
          }
        }
        return this._migrationMap![ref] ?? ref;
      }
    }
    return ref;
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
    return ModelServiceFactory.getModelService(modelConfig);
  }

  async getEmbeddingService(name: string, throwError = false): Promise<IEmbeddingService | undefined> {
    const embeddingConfig = this.getEmbedding(name);
    if (!embeddingConfig) {
      if (throwError) throw new Error(`Embedding config "${name}" not found`);
      return undefined;
    }
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
        this._settings = JSON.parse(content);
      } else {
        // 创建默认配置文件
        this.createDefaultSettings(settingsPath);
      }
    } catch (error) {
      this._settings = {};
    }

    // 自动迁移：settings.agents → 目录结构
    if (this._settings.agents && Object.keys(this._settings.agents).length > 0) {
      this.migrateAgentsToDirectories();
    }
  }

  /**
   * 将 settings.json 中的 agents 迁移到 ~/.sbot/agents/<id>/ 目录结构
   * 幂等：如果目录已存在则跳过
   */
  private migrateAgentsToDirectories(): void {
    const settingsPath = this.getConfigPath("settings.json");
    const backupPath = this.getConfigPath("settings.json.pre-agent-migration");

    // 1. 备份 settings.json（仅首次迁移）
    if (!fs.existsSync(backupPath)) {
      fs.copyFileSync(settingsPath, backupPath);
    }

    const uuidToId: Record<string, string> = {};
    const usedIds = new Set<string>();

    // 收集已有目录名
    const agentsDir = path.join(this._configDir, 'agents');
    if (fs.existsSync(agentsDir)) {
      for (const d of fs.readdirSync(agentsDir, { withFileTypes: true })) {
        if (d.isDirectory()) usedIds.add(d.name);
      }
    }

    // 2. 遍历 settings.agents 并迁移
    for (const [uuid, entry] of Object.entries(this._settings.agents!)) {
      // 计算 id：优先用 name（sanitize），最后用 uuid
      let id = sanitizeId((entry as any).name || uuid);

      // 冲突追加后缀
      if (usedIds.has(id)) {
        let n = 2;
        while (usedIds.has(`${id}-${n}`)) n++;
        id = `${id}-${n}`;
      }
      usedIds.add(id);
      uuidToId[uuid] = id;

      // 幂等检查：目录已存在（含 agent.json）则跳过写入
      const agentDir = this.getConfigPath(`agents/${id}`, true);
      const agentJsonPath = path.join(agentDir, 'agent.json');
      if (fs.existsSync(agentJsonPath)) continue;

      // 提取并分离字段
      const { systemPrompt, storeSource, alias: _alias, id: _id, ...rest } = entry as any;

      // 写入 agent.json
      fs.writeFileSync(agentJsonPath, JSON.stringify(rest, null, 2), 'utf-8');

      // 写入 system-prompt.md
      if (systemPrompt) {
        fs.writeFileSync(path.join(agentDir, 'system-prompt.md'), systemPrompt, 'utf-8');
      }

      // 写入 .store.json
      if (storeSource) {
        fs.writeFileSync(path.join(agentDir, '.store.json'), JSON.stringify(storeSource, null, 2), 'utf-8');
      }
    }

    // 3. 写入 UUID → id 映射
    const mapPath = path.join(this._configDir, '.migration-map.json');
    let existingMap: Record<string, string> = {};
    if (fs.existsSync(mapPath)) {
      try { existingMap = JSON.parse(fs.readFileSync(mapPath, 'utf-8')); } catch { /* ignore */ }
    }
    const mergedMap = { ...existingMap, ...uuidToId };
    fs.writeFileSync(mapPath, JSON.stringify(mergedMap, null, 2), 'utf-8');
    this._migrationMap = mergedMap;

    // 4. 清除 settings.agents 并保存
    delete this._settings.agents;
    this.saveSettings();
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
        [ME1]: { name: "default", mode: MemoryMode.HumanAndAI, maxAgeDays: 90, embedding: E1, evaluator: M1, extractor: M1, compressor: M1, share: false },
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
