/**
 * URL 抓取工具集
 * 从互联网抓取 URL 内容，HTML 自动转 Markdown，支持 robots.txt 合规检查
 */

import axios, { AxiosRequestConfig } from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import robotsParser from 'robots-parser';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { FetchToolsConfig } from './config';

const logger = LoggerService.getLogger('Tools/Fetch/index.ts');

export type { FetchToolsConfig } from './config';

const DEFAULT_USER_AGENT =
    'ModelContextProtocol/1.0 (Autonomous; +https://github.com/modelcontextprotocol/servers)';

// ── Utilities ─────────────────────────────────────────────────────────────────

/** HTML → Markdown：先用 Readability 提取正文，再用 Turndown 转 Markdown */
function htmlToMarkdown(html: string, url: string): string {
    let content = html;
    try {
        const dom = new JSDOM(html, { url });
        const article = new Readability(dom.window.document).parse();
        if (article?.content) content = article.content;
    } catch { /* fallback: convert raw HTML */ }
    const td = new TurndownService({ headingStyle: 'atx', bulletListMarker: '-' });
    return td.turndown(content);
}

/** 根据配置构建 axios 请求选项 */
function buildAxiosConfig(config: FetchToolsConfig, userAgent: string): AxiosRequestConfig {
    const cfg: AxiosRequestConfig = {
        timeout: config.timeout ?? 30000,
        headers: { 'User-Agent': userAgent },
        maxRedirects: 10,
        validateStatus: () => true,   // 手动处理 HTTP 错误状态
        responseType: 'text',
    };
    if (config.proxy) {
        try {
            const p = new URL(config.proxy);
            cfg.proxy = {
                protocol: p.protocol,
                host: p.hostname,
                port: parseInt(p.port || (p.protocol === 'https:' ? '443' : '80')),
                ...(p.username ? { auth: { username: p.username, password: p.password } } : {}),
            };
        } catch { /* 忽略无效代理 URL */ }
    }
    return cfg;
}

/**
 * 检查 robots.txt，返回拒绝原因字符串；允许时返回 null
 * 抓取 robots.txt 本身失败时默认放行
 */
async function checkRobotsTxt(
    url: string,
    userAgent: string,
    axiosCfg: AxiosRequestConfig,
): Promise<string | null> {
    try {
        const robotsUrl = new URL('/robots.txt', url).toString();
        const res = await axios.get(robotsUrl, { ...axiosCfg, timeout: 10000 });
        if (res.status === 401 || res.status === 403) {
            return `robots.txt 返回 ${res.status}，推测不允许自动抓取`;
        }
        if (res.status >= 400) return null;   // 不存在 robots.txt，放行
        const robots = robotsParser(robotsUrl, res.data as string);
        if (!robots.isAllowed(url, userAgent)) {
            return `robots.txt 不允许抓取: ${url}`;
        }
        return null;
    } catch {
        return null;   // 无法取到 robots.txt，放行
    }
}

// ── Tool ──────────────────────────────────────────────────────────────────────

/** 抓取 URL 内容，HTML 自动转 Markdown，支持分页 */
export function createFetchUrlTool(config: FetchToolsConfig = {}): StructuredToolInterface {
    const userAgent = config.userAgent ?? DEFAULT_USER_AGENT;
    return new DynamicStructuredTool({
        name: 'fetch_url',
        description:
            '从互联网抓取 URL 内容。HTML 页面自动提取正文并转为 Markdown；非 HTML 内容直接返回原文。' +
            '支持 startIndex 分页截取长内容。',
        schema: z.object({
            url: z.string().url().describe('要抓取的 URL'),
            maxLength: z.number().int().positive().optional().default(5000)
                .describe('最多返回的字符数，默认 5000'),
            startIndex: z.number().int().min(0).optional().default(0)
                .describe('从第几个字符开始返回（用于翻页续读），默认 0'),
            raw: z.boolean().optional().default(false)
                .describe('返回原始 HTML/文本，跳过 Markdown 转换，默认 false'),
        }) as any,
        func: async ({ url, maxLength = 5000, startIndex = 0, raw = false }: any): Promise<MCPToolResult> => {
            try {
                const axiosCfg = buildAxiosConfig(config, userAgent);

                // robots.txt 合规检查
                if (!config.ignoreRobotsTxt) {
                    const denied = await checkRobotsTxt(url, userAgent, axiosCfg);
                    if (denied) return createErrorResult(denied);
                }

                // 发起请求
                const res = await axios.get<string>(url, axiosCfg);
                if (res.status >= 400) {
                    return createErrorResult(`HTTP ${res.status}: ${url}`);
                }

                const rawContent = typeof res.data === 'string'
                    ? res.data
                    : JSON.stringify(res.data, null, 2);
                const contentType: string = (res.headers['content-type'] as string) ?? '';
                const isHtml =
                    rawContent.trimStart().toLowerCase().startsWith('<!doctype') ||
                    rawContent.trimStart().toLowerCase().startsWith('<html') ||
                    contentType.includes('text/html');

                let content: string;
                let prefix = '';
                if (isHtml && !raw) {
                    content = htmlToMarkdown(rawContent, url);
                } else {
                    content = rawContent;
                    if (!isHtml) prefix = `Content-Type: ${contentType}\n\n`;
                }

                // 分页截取
                const totalLen = content.length;
                if (startIndex >= totalLen) {
                    return createErrorResult('没有更多内容。');
                }
                let slice = content.slice(startIndex, startIndex + maxLength);
                const remaining = totalLen - (startIndex + slice.length);
                if (slice.length === maxLength && remaining > 0) {
                    slice += `\n\n[内容已截断，共 ${totalLen} 字符，请使用 startIndex=${startIndex + maxLength} 继续读取]`;
                }

                return createSuccessResult(createTextContent(`${prefix}${url} 内容:\n${slice}`));
            } catch (e: any) {
                logger.error(`fetch_url ${url}: ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}

/** 创建所有 Fetch 工具 */
export function createFetchTools(config: FetchToolsConfig = {}): StructuredToolInterface[] {
    return [
        createFetchUrlTool(config),
    ];
}
