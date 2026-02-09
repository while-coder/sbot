import os from "os";
import path from "path";
import fs from "fs";


export interface LarkConfig {
  appId?: string;
  appSecret?: string;
  tenantToken?: string; // 可选的手动配置的租户 token
}

export interface ModelConfig {
  provider?: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
  temperature?: number;
}

export interface EmbeddingConfig {
  provider?: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

/**
 * MCP 服务器配置
 * 支持 stdio、http 两种传输方式
 */
export interface MCPServerConfig {
  // === 通用配置 ===
  /** 传输类型（可选，会根据配置结构自动推断） */
  transport?: "stdio" | "http";
  /** 传输类型别名（与 transport 相同，用于兼容） */
  type?: "stdio" | "http";

  // === Stdio 传输配置 ===
  /** 要运行的可执行文件（如 node、npx、python 等）- stdio 必需 */
  command?: string;
  /** 传递给可执行文件的命令行参数 */
  args?: string[];
  /** 环境变量 */
  env?: Record<string, string>;
  /** 进程编码方式 */
  encoding?: string;
  /** 工作目录 */
  cwd?: string;
  /** stderr 处理方式（默认：inherit） */
  stderr?: "overlapped" | "pipe" | "ignore" | "inherit";
  /** 进程重启配置 */
  restart?: {
    /** 是否启用自动重启 */
    enabled?: boolean;
    /** 最大重启次数 */
    maxAttempts?: number;
    /** 重启延迟（毫秒） */
    delayMs?: number;
  };

  // === HTTP 传输配置 ===
  /** 服务器 URL - http 必需 */
  url?: string;
  /** 请求头（用于身份验证等）- http 可用 */
  headers?: Record<string, string>;
  /** OAuth 认证提供者（推荐用于身份验证，自动处理 token 刷新和 401 重试）- http 可用 */
  authProvider?: any; // OAuthClientProvider 类型
  /** 重新连接配置 - http 可用 */
  reconnect?: {
    /** 是否启用自动重连 */
    enabled?: boolean;
    /** 最大重连次数 */
    maxAttempts?: number;
    /** 重连延迟（毫秒） */
    delayMs?: number;
  };
  /** 是否自动回退到 SSE（当 Streamable HTTP 不可用时）- 默认：true */
  automaticSSEFallback?: boolean;

  // === 工具配置 ===
  /** 禁用自动批准的工具列表（需要用户确认） */
  disabledAutoApproveTools?: string[];
  /** 禁用的工具列表（这些工具将不会被加载） */
  disabled?: string[];
  /** 工具执行的默认超时时间（毫秒） */
  defaultToolTimeout?: number;

  // === 输出处理 ===
  /**
   * 工具输出的处理方式
   * - "content": 所有输出放入 ToolMessage.content
   * - "artifact": 所有输出放入 ToolMessage.artifact
   * - 对象: 为每种内容类型单独指定
   */
  outputHandling?: "artifact" | "content" | {
    audio?: "artifact" | "content";
    image?: "artifact" | "content";
    resource?: "artifact" | "content";
    resource_link?: "artifact" | "content";
    text?: "artifact" | "content";
  };
}

export interface MCPServers {
  [serverName: string]: MCPServerConfig;
}

export interface MemoryConfig {
  enabled?: boolean;           // 是否启用长期记忆功能
  autoCleanup?: boolean;       // 是否自动清理过期记忆
  maxAgeDays?: number;         // 记忆最大保留天数
  embedding?: string;          // 记忆使用的 embedding 名称（对应 embeddings 中的 key）
  evaluator?: string;          // 重要性评估器使用的模型名称（对应 models 中的 key）
  compressor?: string;         // 记忆压缩器使用的模型名称（对应 models 中的 key）
}

/**
 * Plan Agent 配置
 */
export interface PlanAgentConfig {
  id: string;                  // Agent 实例 ID
  type: string;                // Agent 类型（如 coder, researcher, analyst 等）
  skillName?: string;          // 关联的 Skill 名称（可选）
  tools: string[];             // 可用工具列表，["*"] 表示所有工具
  systemPrompt?: string;       // 自定义系统提示词
}

/**
 * Plan 模式配置
 */
export interface PlanConfig {
  mode?: "single" | "supervisor" | "react";  // 运行模式
  maxIterations?: number;                     // ReAct 模式最大迭代次数
  agents?: PlanAgentConfig[];                 // Agent 配置列表
}

export interface Settings {
  model?: string; // 当前使用的模型名称（对应 models 中的 key）
  lark?: LarkConfig;
  models?: Record<string, ModelConfig>; // 多个模型配置
  embeddings?: Record<string, EmbeddingConfig>; // 多个 embedding 配置
  memory?: MemoryConfig; // 长期记忆配置
  plan?: PlanConfig; // Plan 模式配置
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

  getModelName(): string {
    return this._settings.model || "";
  }

  /**
   * 根据名称获取模型配置
   * @param name 模型名称（对应 settings.models 中的 key），不传则使用当前选中的模型
   * @returns 模型配置，如果未配置则返回 undefined
   */
  getModel(name?: string): ModelConfig | undefined {
    if (!this._settings.models) return undefined;

    const modelName = name ?? this._settings.model;
    if (!modelName || typeof modelName !== 'string') return undefined;

    return this._settings.models[modelName.trim()];
  }

  /**
   * 获取当前使用的模型配置
   * @returns 当前模型配置，如果未配置则返回 undefined
   */
  getCurrentModel(): ModelConfig | undefined {
    return this.getModel();
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
   * 获取内置的 MCP 服务器配置
   * @returns 内置的 MCP 服务器配置对象
   */
  getBuiltinMcpServers(): MCPServers {
    return {
      "playwright": {
        command: "npx",
        args: ["@playwright/mcp@latest"],
        disabledAutoApproveTools: []
      },
      "windows-mcp": {
        command: "uvx",
        args: ["windows-mcp"],
        disabledAutoApproveTools: []
      }
    };
  }

  /**
   * 获取默认配置
   */
  private getDefaultSettings(): Settings {
    return {
      model: "openai-gpt4",
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
        compressor: "openai-gpt4"
      },
      models: {
        "openai-gpt4": {
          provider: "openai",
          apiKey: "your-api-key",
          baseURL: "https://api.openai.com/v1",
          model: "gpt-4"
        },
        "claude": {
          provider: "anthropic",
          apiKey: "your-api-key",
          baseURL: "https://api.anthropic.com",
          model: "claude-3-opus-20240229"
        },
        "azure": {
          provider: "azure",
          apiKey: "your-api-key",
          baseURL: "https://your-resource.openai.azure.com",
          model: "gpt-4"
        }
      },
      embeddings: {
        "openai-ada": {
          provider: "openai",
          apiKey: "your-api-key",
          baseURL: "https://api.openai.com/v1",
          model: "text-embedding-ada-002"
        },
        "openai-3-small": {
          provider: "openai",
          apiKey: "your-api-key",
          baseURL: "https://api.openai.com/v1",
          model: "text-embedding-3-small"
        },
        "openai-3-large": {
          provider: "openai",
          apiKey: "your-api-key",
          baseURL: "https://api.openai.com/v1",
          model: "text-embedding-3-large"
        },
        "azure-ada": {
          provider: "azure",
          apiKey: "your-api-key",
          baseURL: "https://your-resource.openai.azure.com",
          model: "text-embedding-ada-002"
        }
      },
      plan: {
        mode: "single",
        maxIterations: 5,
        agents: [
          {
            id: "coder-1",
            type: "coder",
            tools: ["read_file", "write_file", "execute_command"],
            systemPrompt: "你是一个开发专家，擅长编写高质量代码"
          },
          {
            id: "researcher-1",
            type: "researcher",
            tools: ["web_search", "read_url"],
            systemPrompt: "你是一个研究专家，擅长搜索和分析信息"
          }
        ]
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
    // 检查 model 字段类型和值
    if (!this._settings.model || typeof this._settings.model !== 'string' || this._settings.model.trim() === "") {
      errors.push("缺少 model 配置项，请在配置文件顶部指定当前使用的模型名称（如: model = \"openai-gpt4\"）");
    }

    // 检查是否有模型配置
    if (!this._settings.models || Object.keys(this._settings.models).length === 0) {
      errors.push("缺少模型配置 [models]，请在配置文件中添加至少一个模型配置");
    } else if (this._settings.model && typeof this._settings.model === 'string' && this._settings.model.trim() !== "") {
      // 验证指定的模型是否存在
      const currentModelName = this._settings.model.trim();
      const currentModel = this._settings.models[currentModelName];

      if (!currentModel) {
        errors.push(`指定的模型 "${currentModelName}" 不存在，请在 [models.${currentModelName}] 中配置或修改 model 字段`);
      } else {
        // 验证当前模型的配置是否完整
        const { apiKey, baseURL, model } = currentModel;

        if (!apiKey || apiKey.trim() === "") {
          errors.push(`模型 "${currentModelName}" 缺少 apiKey，请在 [models.${currentModelName}] 中填写 apiKey`);
        }

        if (!baseURL || baseURL.trim() === "") {
          errors.push(`模型 "${currentModelName}" 缺少 baseURL，请在 [models.${currentModelName}] 中填写 baseURL`);
        }

        if (!model || model.trim() === "") {
          errors.push(`模型 "${currentModelName}" 缺少 model，请在 [models.${currentModelName}] 中填写 model`);
        }
      }
    }

    // 如果有错误，抛出异常
    if (errors.length > 0) {
      throw new Error(errors.join("\n"));
    }
  }
}

export const config = new Config();
