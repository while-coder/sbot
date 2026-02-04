import os from "os";
import path from "path";
import fs from "fs";
import log4js from "log4js";
import * as toml from "@iarna/toml";

const logger = log4js.getLogger("Config.ts");

export interface FeishuConfig {
  appId?: string;
  appSecret?: string;
}

export interface ModelConfig {
  provider?: string;
  apiKey?: string;
  baseURL?: string;
  model?: string;
}

export interface Settings {
  feishu?: FeishuConfig;
  model?: ModelConfig;
}

class Config {
  private _configDir: string;
  private _settings: Settings = {};

  constructor() {
    // 获取用户目录
    const userHome = os.homedir();
    this._configDir = path.join(userHome, ".sbot");

    // 确保配置目录存在
    this.ensureConfigDir();

    // 加载配置文件
    this.loadSettings();
  }

  /**
   * 获取配置目录路径
   */
  get configDir(): string {
    return this._configDir;
  }

  /**
   * 获取配置内容
   */
  get settings(): Settings {
    return this._settings;
  }

  /**
   * 确保配置目录存在
   */
  private ensureConfigDir(): void {
    if (!fs.existsSync(this._configDir)) {
      fs.mkdirSync(this._configDir, { recursive: true });
      logger.info(`创建配置目录: ${this._configDir}`);
    }
  }

  /**
   * 加载配置文件
   */
  private loadSettings(): void {
    const settingsPath = this.getConfigPath("settings.toml");

    try {
      if (fs.existsSync(settingsPath)) {
        const content = fs.readFileSync(settingsPath, "utf-8");
        this._settings = toml.parse(content);
        logger.info(`成功加载配置文件: ${settingsPath}`);
      } else {
        logger.warn(`配置文件不存在: ${settingsPath}`);
        // 创建默认配置文件
        this.createDefaultSettings(settingsPath);
      }
    } catch (error) {
      logger.error(`加载配置文件失败: ${settingsPath}`, error);
      this._settings = {};
    }
  }

  /**
   * 创建默认配置文件
   */
  private createDefaultSettings(settingsPath: string): void {
    const defaultSettings = `# SBot 配置文件

[feishu]
# 飞书应用配置
# 请填写您的飞书应用 App ID 和 App Secret
appId = ""
appSecret = ""

[model]
# AI 模型配置
# provider: 模型提供商 (如: openai, anthropic, azure, etc)
# apiKey: API 密钥
# baseURL: API 基础地址 (可选)
# model: 模型名称 (如: gpt-4, claude-3-opus, etc)
provider = ""
apiKey = ""
baseURL = ""
model = ""
`;

    try {
      fs.writeFileSync(settingsPath, defaultSettings, "utf-8");
      logger.info(`创建默认配置文件: ${settingsPath}`);
      this._settings = toml.parse(defaultSettings);
    } catch (error) {
      logger.error(`创建默认配置文件失败: ${settingsPath}`, error);
    }
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
   * @param options 选项
   * @param options.ensureDir 是否确保目录存在（默认 true）。如果路径是文件，则确保其父目录存在；如果是目录，则确保该目录存在
   * @param options.isDirectory 明确指定路径是否为目录（默认根据是否有扩展名判断）
   * @returns 完整的文件或目录路径
   *
   * @example
   * // 获取文件路径，自动创建父目录
   * config.getConfigPath("settings.toml")  // ~/.sbot/settings.toml
   * config.getConfigPath("logs/app.log")   // ~/.sbot/logs/app.log (自动创建 logs 目录)
   *
   * // 获取目录路径，自动创建该目录
   * config.getConfigPath("cache", { isDirectory: true })  // ~/.sbot/cache (自动创建)
   * config.getConfigPath("data/images", { isDirectory: true })  // ~/.sbot/data/images (自动创建多层目录)
   *
   * // 仅获取路径，不创建目录
   * config.getConfigPath("temp/file.txt", { ensureDir: false })
   */
  getConfigPath(pathSegment: string, options: { ensureDir?: boolean; isDirectory?: boolean } = {}): string {
    const { ensureDir = true, isDirectory } = options;
    const fullPath = path.join(this._configDir, pathSegment);

    if (ensureDir) {
      let dirToEnsure: string;

      if (isDirectory !== undefined) {
        // 明确指定是否为目录
        dirToEnsure = isDirectory ? fullPath : path.dirname(fullPath);
      } else {
        // 根据是否有扩展名自动判断（有扩展名认为是文件，否则认为是目录）
        const hasExtension = path.extname(pathSegment) !== "";
        dirToEnsure = hasExtension ? path.dirname(fullPath) : fullPath;
      }

      // 确保目录存在
      if (!fs.existsSync(dirToEnsure)) {
        fs.mkdirSync(dirToEnsure, { recursive: true });
        logger.info(`创建目录: ${dirToEnsure}`);
      }
    }

    return fullPath;
  }

  /**
   * 验证飞书配置是否完整
   * @throws 如果配置不完整则抛出错误
   */
  validateFeishuConfig(): void {
    if (!this._settings.feishu) {
      throw new Error("缺少飞书配置 [feishu]，请在配置文件中添加飞书应用配置");
    }

    const { appId, appSecret } = this._settings.feishu;

    if (!appId || appId.trim() === "") {
      throw new Error("飞书配置缺少 appId，请在配置文件 [feishu] 区间中填写 appId");
    }

    if (!appSecret || appSecret.trim() === "") {
      throw new Error("飞书配置缺少 appSecret，请在配置文件 [feishu] 区间中填写 appSecret");
    }

    logger.info("飞书配置验证通过");
  }
}

export const config = new Config();
