import os from "os";
import path from "path";
import fs from "fs";
import { ModelConfig, ModelProvider, EmbeddingConfig, EmbeddingProvider, MCPServerConfig, MCPServers, MemoryConfig } from "scorpio.ai";


export interface LarkConfig {
  appId?: string;
  appSecret?: string;
}

/**
 * Agent 运行模式
 */
export enum AgentMode {
  Single = "single",   // 单 Agent 模式
  ReAct = "react",     // ReAct 模式：思考 -> 行动 -> 观察，迭代决策
}

/**
 * 编排节点配置（用于 ReAct 的 think/reflect 节点）
 */
export interface AgentNodeConfig {
  model?: string;              // 使用的模型名称（对应 models 中的 key）
  skills?: string[];           // 关联的 Skill 名称列表
}

/**
 * 子 Agent 引用（用于 ReactAgentEntry.agents）
 */
export interface AgentRef {
  name: string;                // 引用的 Agent 名称（对应 agents 中的 key）
  desc: string;                // Agent 描述，用于 LLM 规划时参考
}

/**
 * Agent 基础配置（所有模式共用）
 */
export interface BaseAgentEntry {
  type: AgentMode;
  mcp?: string[];              // Agent 专属 MCP 服务器名称列表（对应 mcp.json 中的 key）
  skills?: string[];           // 全局 Skills 过滤列表（skill 名称），不填则加载所有全局 Skills
}

/**
 * Single 模式 Agent 配置
 */
export interface SingleAgentEntry extends BaseAgentEntry {
  type: AgentMode.Single;
  model?: string;              // 使用的模型名称（对应 models 中的 key），不填则使用全局 model
  systemPrompt?: string;       // 系统提示词
}

/**
 * ReAct 模式 Agent 配置
 */
export interface ReactAgentEntry extends BaseAgentEntry {
  type: AgentMode.ReAct;
  maxIterations?: number;      // 最大迭代次数，默认 5
  think?: AgentNodeConfig;     // Think 节点配置
  reflect?: AgentNodeConfig;   // Reflect 节点配置
  agents: AgentRef[];          // 子 Agent 引用列表
}

/**
 * Agent 配置条目（联合类型）
 */
export type AgentEntry = SingleAgentEntry | ReactAgentEntry;

export interface Settings {
  agent?: string;              // 当前使用的 Agent 名称（对应 agents 中的 key）
  lark?: LarkConfig;
  models?: Record<string, ModelConfig>;
  embeddings?: Record<string, EmbeddingConfig>;
  memory?: MemoryConfig;
  agents?: Record<string, AgentEntry>;
}

class Config {
  private _configDir: string;
  private _settings: Settings = {};

  constructor() {
    // 获取用户目录
    const userHome = os.homedir();
    this._configDir = path.join(userHome, ".sbot");

    // 每次启动都生成示例配置文件
    this.createExampleSettings();
    this.createExampleMcpConfig();

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
  getModel(name?: string): ModelConfig | undefined {
    if (!this._settings.models || !name) return undefined;
    return this._settings.models[name.trim()];
  }

  /**
   * 根据名称获取 embedding 配置
   * @param name embedding 名称（对应 settings.embeddings 中的 key）
   * @returns embedding 配置，如果未配置则返回 undefined
   */
  getEmbedding(name: string): EmbeddingConfig | undefined {
    if (!this._settings.embeddings) return undefined;
    return this._settings.embeddings[name.trim()];
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
  getMcpServers(): MCPServers {
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
   * 获取默认配置
   */
  private getDefaultSettings(): Settings {
    return {
      agent: "default",
      lark: {
        appId: "",
        appSecret: ""
      },
      memory: {
        enabled: true,
        autoCleanup: true,
        maxAgeDays: 90,
        embedding: "openai-ada",
        evaluator: "openai-gpt4",
        extractor: "openai-gpt4",
        compressor: "openai-gpt4"
      },
      models: {
        "openai-gpt4": {
          provider: ModelProvider.OpenAI,
          apiKey: "your-api-key",
          baseURL: "https://api.openai.com/v1",
          model: "gpt-4"
        },
        "claude": {
          provider: "anthropic" as any,
          apiKey: "your-api-key",
          baseURL: "https://api.anthropic.com",
          model: "claude-3-opus-20240229"
        },
        "azure": {
          provider: "azure" as any,
          apiKey: "your-api-key",
          baseURL: "https://your-resource.openai.azure.com",
          model: "gpt-4"
        }
      },
      embeddings: {
        "openai-ada": {
          provider: EmbeddingProvider.OpenAI,
          apiKey: "your-api-key",
          baseURL: "https://api.openai.com/v1",
          model: "text-embedding-ada-002"
        },
        "openai-3-small": {
          provider: EmbeddingProvider.OpenAI,
          apiKey: "your-api-key",
          baseURL: "https://api.openai.com/v1",
          model: "text-embedding-3-small"
        },
        "openai-3-large": {
          provider: EmbeddingProvider.OpenAI,
          apiKey: "your-api-key",
          baseURL: "https://api.openai.com/v1",
          model: "text-embedding-3-large"
        },
        "azure-ada": {
          provider: "azure" as any,
          apiKey: "your-api-key",
          baseURL: "https://your-resource.openai.azure.com",
          model: "text-embedding-ada-002"
        }
      },
      agents: {
        "default": {
          type: AgentMode.Single,
          model: "openai-gpt4",
          systemPrompt: "你是一个有用的AI助手"
        },
        "coder": {
          type: AgentMode.Single,
          model: "openai-gpt4",
          systemPrompt: "你是一个开发专家，擅长编写高质量代码"
        },
        "researcher": {
          type: AgentMode.Single,
          model: "openai-gpt4",
          systemPrompt: "你是一个研究专家，擅长搜索和分析信息"
        },
        "react-example": {
          type: AgentMode.ReAct,
          maxIterations: 5,
          think: { model: "openai-gpt4" },
          reflect: { model: "openai-gpt4" },
          agents: [
            { name: "coder", desc: "开发专家，擅长编写高质量代码" },
            { name: "researcher", desc: "研究专家，擅长搜索和分析信息" }
          ]
        }
      }
    };
  }

  /**
   * 每次启动时生成示例配置文件 settings.json.example
   */
  private createExampleSettings(): void {
    const examplePath = this.getConfigPath("settings.json.example");

    try {
      fs.writeFileSync(examplePath, JSON.stringify(this.getDefaultSettings(), null, 2), "utf-8");
    } catch (error) {
      // 忽略错误
    }
  }

  /**
   * 每次启动时生成 MCP 配置示例文件 mcp.json.example
   */
  private createExampleMcpConfig(): void {
    const examplePath = this.getConfigPath("mcp.json.example");

    try {
      fs.writeFileSync(examplePath, JSON.stringify(this.getDefaultMcpConfig(), null, 2), "utf-8");
    } catch (error) {
      // 忽略错误
    }
  }

  /**
   * 获取默认 MCP 配置
   */
  private getDefaultMcpConfig(): { mcpServers: MCPServers } {
    return {
      mcpServers: {
        "python-server": {
          command: "python",
          args: ["-m", "your_mcp_module"],
          disabledAutoApproveTools: []
        },
        "local-node-server": {
          transport: "stdio",
          command: "node",
          args: ["path/to/your/mcp-server.js"],
          cwd: "/path/to/working/directory",
          stderr: "inherit",
          defaultToolTimeout: 30000,
          disabledAutoApproveTools: ["dangerous_tool"],
          env: {
            "API_KEY": "your-api-key-here",
            "NODE_ENV": "production"
          },
          restart: {
            enabled: true,
            maxAttempts: 3,
            delayMs: 1000
          }
        },
        "remote-http-server": {
          transport: "http",
          url: "https://mcp-server.example.com",
          automaticSSEFallback: true,
          defaultToolTimeout: 60000,
          disabledAutoApproveTools: [],
          headers: {
            "Authorization": "Bearer your-token",
            "X-Custom-Header": "custom-value"
          },
          reconnect: {
            enabled: true,
            maxAttempts: 5,
            delayMs: 2000
          }
        }
      }
    };
  }


  /**
   * 创建默认配置文件
   */
  private createDefaultSettings(settingsPath: string): void {
    try {
      this._settings = this.getDefaultSettings();
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
  getUserSaverPath(userId: string) {
    return this.getConfigPath(`users/${userId}/saver.sqlite`)
  }
  getUserMemoryPath(userId: string) {
    return this.getConfigPath(`users/${userId}/memory.sqlite`)
  }
  /**
   * 验证所有配置是否完整
   * @throws 如果配置不完整则抛出错误
   */
  validateConfig(): void {
    const errors: string[] = [];

    // 验证 Lark 配置
    if (!this._settings.lark) {
      errors.push("缺少 Lark 配置 [lark]，请在配置文件中添加 Lark 应用配置");
    } else {
      const { appId, appSecret } = this._settings.lark;

      if (!appId || appId.trim() === "") {
        errors.push("Lark 配置缺少 appId，请在配置文件 [lark] 区间中填写 appId");
      }

      if (!appSecret || appSecret.trim() === "") {
        errors.push("Lark 配置缺少 appSecret，请在配置文件 [lark] 区间中填写 appSecret");
      }
    }

    // 验证模型配置
    if (!this._settings.models || Object.keys(this._settings.models).length === 0) {
      errors.push("缺少模型配置 [models]，请在配置文件中添加至少一个模型配置");
    }

    // 如果有错误，抛出异常
    if (errors.length > 0) {
      throw new Error(errors.join("\n"));
    }
  }
}

export const config = new Config();
