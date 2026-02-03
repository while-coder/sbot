import os from "os";
import path from "path";
import fs from "fs";
import log4js from "log4js";

const logger = log4js.getLogger("Config.ts");

class Config {
  private _configDir: string;

  constructor() {
    // 获取用户目录
    const userHome = os.homedir();
    this._configDir = path.join(userHome, ".sbot");

    // 确保配置目录存在
    this.ensureConfigDir();
  }

  /**
   * 获取配置目录路径
   */
  get configDir(): string {
    return this._configDir;
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
   * 获取配置目录下的文件路径
   * @param filename 文件名
   * @returns 完整的文件路径
   */
  getConfigPath(filename: string): string {
    return path.join(this._configDir, filename);
  }

  /**
   * 确保配置目录下的子目录存在
   * @param subDir 子目录名
   * @returns 子目录的完整路径
   */
  ensureSubDir(subDir: string): string {
    const subDirPath = path.join(this._configDir, subDir);
    if (!fs.existsSync(subDirPath)) {
      fs.mkdirSync(subDirPath, { recursive: true });
      logger.info(`创建子目录: ${subDirPath}`);
    }
    return subDirPath;
  }
}

export const config = new Config();
