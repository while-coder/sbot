/**
 * 文件系统工具配置
 */

/**
 * 文件系统工具配置接口
 */
export interface FileSystemToolsConfig {
    /** 文件大小限制（字节），默认为 10MB */
    maxFileSize: number;
}

/**
 * 默认配置
 */
export const DEFAULT_CONFIG: FileSystemToolsConfig = {
    maxFileSize: 10 * 1024 * 1024 // 10MB
};
