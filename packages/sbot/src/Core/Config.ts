import os from "os";
import path from "path";
import fs from "fs";
import { ModelConfig, ModelProvider, EmbeddingConfig, EmbeddingProvider, MCPServers, IModelService, IEmbeddingService, ModelServiceFactory, EmbeddingServiceFactory, type AgentSubNode } from "scorpio.ai";
export type { AgentSubNode } from "scorpio.ai";
import { DEFAULT_PORT, SaverType, AgentMode, SaverConfig, MemoryConfig, SessionConfig, ChannelConfig, DirectoryConfig, LocalDirConfig } from "sbot.commons";
export { DEFAULT_PORT, SaverType, AgentMode, ChannelType, SaverConfig, MemoryConfig, SessionConfig, ChannelConfig, DirectoryConfig, LocalDirConfig } from "sbot.commons";

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
  systemPrompt?: string;       // 系统提示词（single 模式直接使用；react 模式注入所有子 Agent）
}

/**
 * Single 模式 Agent 配置
 */
export interface SingleAgentEntry extends BaseAgentEntry {
  type: AgentMode.Single;
  model?: string;              // 使用的模型 UUID（对应 models 中的 key），不填则使用全局 model
  mcp?: string[];              // Agent 专属 MCP 服务器名称列表（对应 mcp.json 中的 key）
  skills?: string[];           // 全局 Skills 过滤列表（skill 名称），不填则加载所有全局 Skills
}

/**
 * ReAct 模式 Agent 配置
 */
export interface ReactAgentEntry extends BaseAgentEntry {
  type: AgentMode.ReAct;
  think?: string;              // Think 节点使用的模型 UUID（对应 models 中的 key）
  mcp?: string[];              // MCP 服务列表（对应全局 mcp 中的 key）
  skills?: string[];           // Skill 目录列表（对应全局 skills 中的 key）
  agents: AgentSubNode[];      // 子 Agent 引用列表（name 字段为 agent UUID）
}

/**
 * Agent 配置条目（联合类型）
 */
export type AgentEntry = SingleAgentEntry | ReactAgentEntry;

export interface Settings {
  httpPort?: number;           // HTTP 服务监听端口，默认 5500
  httpUrl?: string;            // HTTP 服务对外访问的根 URL，默认 http://localhost:5500
  models?: Record<string, NamedModelConfig>;
  embeddings?: Record<string, NamedEmbeddingConfig>;
  savers?: Record<string, SaverConfig>;
  memories?: Record<string, MemoryConfig>;
  agents?: Record<string, AgentEntry>;
  sessions?: Record<string, SessionConfig>;
  channels?: Record<string, ChannelConfig>;
  directories?: Record<string, DirectoryConfig>;
}

class Config {
  private _configDir: string;
  private _settings: Settings = {};
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

  getAgent(id: string): AgentEntry {
    const entry = this._settings.agents?.[id.trim()];
    if (!entry) throw new Error(`Agent config "${id}" not found`);
    return entry;
  }

  getSaver(id: string): SaverConfig | undefined {
    if (!this._settings.savers) return undefined;
    return this._settings.savers[id.trim()];
  }

  getMemory(id: string): MemoryConfig | undefined {
    if (!this._settings.memories) return undefined;
    return this._settings.memories[id.trim()];
  }

  getSession(id: string): SessionConfig | undefined {
    if (!this._settings.sessions) return undefined;
    return this._settings.sessions[id.trim()];
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
    const M3 = "10000000-0000-0000-0000-000000000003";
    const E1 = "20000000-0000-0000-0000-000000000001";
    const E2 = "20000000-0000-0000-0000-000000000002";
    const E3 = "20000000-0000-0000-0000-000000000003";
    const E4 = "20000000-0000-0000-0000-000000000004";
    const S1 = "30000000-0000-0000-0000-000000000001";
    const ME1 = "40000000-0000-0000-0000-000000000001";
    const A1  = "50000000-0000-0000-0000-000000000001";
    const A2  = "50000000-0000-0000-0000-000000000002";
    const A3  = "50000000-0000-0000-0000-000000000003";
    const A4  = "50000000-0000-0000-0000-000000000004";

    const example: Settings = {
      savers: {
        [S1]: { name: "default", type: SaverType.Sqlite },
      },
      memories: {
        [ME1]: { name: "default", autoCleanup: true, maxAgeDays: 90, embedding: E1, evaluator: M1, extractor: M1, compressor: M1 },
      },
      models: {
        [M1]: { name: "openai-gpt4",   provider: ModelProvider.OpenAI,     apiKey: "your-api-key", baseURL: "https://api.openai.com/v1",               model: "gpt-4" },
        [M2]: { name: "claude",         provider: "anthropic" as any,        apiKey: "your-api-key", baseURL: "https://api.anthropic.com",               model: "claude-3-opus-20240229" },
        [M3]: { name: "azure",          provider: "azure" as any,            apiKey: "your-api-key", baseURL: "https://your-resource.openai.azure.com",  model: "gpt-4" },
      },
      embeddings: {
        [E1]: { name: "openai-ada",     provider: EmbeddingProvider.OpenAI, apiKey: "your-api-key", baseURL: "https://api.openai.com/v1",               model: "text-embedding-ada-002" },
        [E2]: { name: "openai-3-small", provider: EmbeddingProvider.OpenAI, apiKey: "your-api-key", baseURL: "https://api.openai.com/v1",               model: "text-embedding-3-small" },
        [E3]: { name: "openai-3-large", provider: EmbeddingProvider.OpenAI, apiKey: "your-api-key", baseURL: "https://api.openai.com/v1",               model: "text-embedding-3-large" },
        [E4]: { name: "azure-ada",      provider: "azure" as any,            apiKey: "your-api-key", baseURL: "https://your-resource.openai.azure.com", model: "text-embedding-ada-002" },
      },
      agents: {
        [A1]: { name: "default",      type: AgentMode.Single, model: M1, systemPrompt: "你是一个有用的AI助手" },
        [A2]: { name: "coder",        type: AgentMode.Single, model: M1, systemPrompt: "你是一个开发专家，擅长编写高质量代码" },
        [A3]: { name: "researcher",   type: AgentMode.Single, model: M1, systemPrompt: "你是一个研究专家，擅长搜索和分析信息" },
        [A4]: { name: "react-example", type: AgentMode.ReAct, think: M1,
                agents: [{ id: A2, desc: "开发专家，擅长编写高质量代码" }, { id: A3, desc: "研究专家，擅长搜索和分析信息" }] },
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
  getSaverPath(saverName: string) {
    return this.getConfigPath(`savers/${saverName}/saver.sqlite`)
  }
  getSaverDir(saverName: string) {
    return this.getConfigPath(`savers/${saverName}/messages`, true)
  }
  getMemoryPath(memoryName: string) {
    return this.getConfigPath(`memories/${memoryName}/memory.sqlite`)
  }

  /** 读取目录本地配置；路径不存在或解析失败时返回 null */
  getDirectoryConfig(dirPath: string): LocalDirConfig | null {
    try {
      const cfgPath = path.join(dirPath, '.sbot', 'settings.json');
      return JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) as LocalDirConfig;
    } catch {
      return null;
    }
  }

  /** 写入目录本地配置到 <dirPath>/.sbot/settings.json */
  saveDirectoryConfig(dirPath: string, cfg: LocalDirConfig): void {
    const sbotDir = path.join(dirPath, '.sbot');
    if (!fs.existsSync(sbotDir)) fs.mkdirSync(sbotDir, { recursive: true });
    fs.writeFileSync(path.join(sbotDir, 'settings.json'), JSON.stringify(cfg, null, 2), 'utf-8');
  }

}

export const config = new Config();
