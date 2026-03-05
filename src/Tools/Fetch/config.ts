/**
 * URL 抓取工具配置
 */

export interface FetchToolsConfig {
    /** HTTP 请求超时（毫秒），默认 30000 */
    timeout?: number;
    /** 自定义 User-Agent */
    userAgent?: string;
    /** HTTP 代理 URL，如 http://proxy:8080 */
    proxy?: string;
    /** 忽略 robots.txt 限制，默认 false */
    ignoreRobotsTxt?: boolean;
}
