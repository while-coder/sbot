/**
 * Web 工具集
 * 提供 webfetch, websearch, codesearch 三个工具
 */

import axios from 'axios';
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import TurndownService from 'turndown';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { loadPrompt } from '../_prompts/index';

const logger = LoggerService.getLogger('Tools/Web/index.ts');

// ── 工具函数 ───────────────────────────────────────────────────────────────────

const DEFAULT_USER_AGENT =
    'ModelContextProtocol/1.0 (Autonomous; +https://github.com/modelcontextprotocol/servers)';

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

// ── Exa AI MCP 请求工具函数 ───────────────────────────────────────────────────

const EXA_MCP_URL = 'https://mcp.exa.ai/mcp';

interface ExaMcpRequest {
    jsonrpc: string;
    id: number;
    method: string;
    params: {
        name: string;
        arguments: Record<string, any>;
    };
}

interface ExaMcpResponse {
    jsonrpc: string;
    result: {
        content: Array<{
            type: string;
            text: string;
        }>;
    };
}

/** 向 Exa AI MCP 发送 JSON-RPC 请求，解析 SSE 响应 */
async function callExaMcp(request: ExaMcpRequest, timeout: number = 30000): Promise<string> {
    const response = await axios.post(EXA_MCP_URL, request, {
        headers: {
            'accept': 'application/json, text/event-stream',
            'content-type': 'application/json',
        },
        timeout,
        responseType: 'text',
        validateStatus: () => true,
    });

    if (response.status >= 400) {
        throw new Error(`Exa API error (${response.status}): ${typeof response.data === 'string' ? response.data : JSON.stringify(response.data)}`);
    }

    const responseText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);

    // 解析 SSE 响应
    const lines = responseText.split('\n');
    for (const line of lines) {
        if (line.startsWith('data: ')) {
            try {
                const data: ExaMcpResponse = JSON.parse(line.substring(6));
                if (data.result?.content?.length > 0) {
                    return data.result.content[0].text;
                }
            } catch { /* 非 JSON 行，跳过 */ }
        }
    }

    // 尝试直接解析为 JSON（非 SSE 格式）
    try {
        const data: ExaMcpResponse = JSON.parse(responseText);
        if (data.result?.content?.length > 0) {
            return data.result.content[0].text;
        }
    } catch { /* 非 JSON */ }

    return '';
}

// ── webfetch ────────────────────────────────────────────────────────────────────

export function createWebFetchTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'webfetch',
        description: loadPrompt('webfetch') || '从 URL 抓取内容',
        schema: z.object({
            url: z.string().describe('要抓取的 URL'),
            format: z.enum(['markdown', 'text', 'html']).optional().default('markdown')
                .describe('返回格式：markdown（默认）、text 或 html'),
        }) as any,
        func: async ({ url, format = 'markdown' }: any): Promise<MCPToolResult> => {
            try {
                // 自动升级 HTTP 到 HTTPS
                const fetchUrl = url.replace(/^http:\/\//, 'https://');

                const response = await axios.get(fetchUrl, {
                    timeout: 30000,
                    headers: { 'User-Agent': DEFAULT_USER_AGENT },
                    maxRedirects: 10,
                    validateStatus: () => true,
                    responseType: 'text',
                });

                if (response.status >= 400) {
                    return createErrorResult(`HTTP ${response.status}: ${fetchUrl}`);
                }

                const rawContent = typeof response.data === 'string'
                    ? response.data
                    : JSON.stringify(response.data, null, 2);

                const contentType: string = (response.headers['content-type'] as string) ?? '';
                const isHtml =
                    rawContent.trimStart().toLowerCase().startsWith('<!doctype') ||
                    rawContent.trimStart().toLowerCase().startsWith('<html') ||
                    contentType.includes('text/html');

                let content: string;
                if (format === 'html' || !isHtml) {
                    content = rawContent;
                } else if (format === 'text') {
                    // 提取纯文本
                    try {
                        const dom = new JSDOM(rawContent, { url: fetchUrl });
                        content = dom.window.document.body?.textContent || rawContent;
                    } catch {
                        content = rawContent;
                    }
                } else {
                    // markdown（默认）
                    content = isHtml ? htmlToMarkdown(rawContent, fetchUrl) : rawContent;
                }

                // 截断过长内容
                const MAX_LENGTH = 50000;
                if (content.length > MAX_LENGTH) {
                    content = content.slice(0, MAX_LENGTH) +
                        `\n\n[内容已截断，共 ${content.length} 字符，仅显示前 ${MAX_LENGTH} 字符]`;
                }

                return createSuccessResult(createTextContent(content));
            } catch (e: any) {
                logger.error(`webfetch ${url}: ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}

// ── websearch ───────────────────────────────────────────────────────────────────

export function createWebSearchTool(): StructuredToolInterface {
    const description = (loadPrompt('websearch') || 'Web 搜索')
        .replace('{{year}}', new Date().getFullYear().toString());

    return new DynamicStructuredTool({
        name: 'websearch',
        description,
        schema: z.object({
            query: z.string().describe('搜索查询'),
            numResults: z.number().optional().default(8).describe('返回结果数量，默认 8'),
            livecrawl: z.enum(['fallback', 'preferred']).optional().default('fallback')
                .describe("实时爬取模式: 'fallback'（备用）或 'preferred'（优先），默认 'fallback'"),
            type: z.enum(['auto', 'fast', 'deep']).optional().default('auto')
                .describe("搜索类型: 'auto'（均衡）、'fast'（快速）、'deep'（深度），默认 'auto'"),
            contextMaxCharacters: z.number().optional()
                .describe('上下文最大字符数，用于 LLM 优化，默认 10000'),
        }) as any,
        func: async ({ query, numResults = 8, livecrawl = 'fallback', type = 'auto', contextMaxCharacters }: any): Promise<MCPToolResult> => {
            try {
                const request: ExaMcpRequest = {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: {
                        name: 'web_search_exa',
                        arguments: {
                            query,
                            numResults,
                            livecrawl,
                            type,
                            ...(contextMaxCharacters ? { contextMaxCharacters } : {}),
                        },
                    },
                };

                const result = await callExaMcp(request, 25000);

                if (!result) {
                    return createSuccessResult(createTextContent('没有找到搜索结果，请尝试其他查询。'));
                }

                return createSuccessResult(createTextContent(result));
            } catch (e: any) {
                logger.error(`websearch "${query}": ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}

// ── codesearch ──────────────────────────────────────────────────────────────────

export function createCodeSearchTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'codesearch',
        description: loadPrompt('codesearch') || '搜索代码上下文',
        schema: z.object({
            query: z.string().describe('搜索查询，例如 "React useState hook examples"、"Express.js middleware"'),
            tokens: z.number().min(1000).max(50000).optional().default(5000)
                .describe('返回的 token 数量（1000-50000），默认 5000'),
        }) as any,
        func: async ({ query, tokens = 5000 }: any): Promise<MCPToolResult> => {
            try {
                const request: ExaMcpRequest = {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'tools/call',
                    params: {
                        name: 'get_code_context_exa',
                        arguments: {
                            query,
                            tokensNum: tokens,
                        },
                    },
                };

                const result = await callExaMcp(request, 30000);

                if (!result) {
                    return createSuccessResult(createTextContent(
                        '没有找到相关代码或文档，请尝试更具体的查询或检查框架名称拼写。'
                    ));
                }

                return createSuccessResult(createTextContent(result));
            } catch (e: any) {
                logger.error(`codesearch "${query}": ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}

// ── 导出工具集 ──────────────────────────────────────────────────────────────────

export function createWebTools(): StructuredToolInterface[] {
    return [
        createWebFetchTool(),
        createWebSearchTool(),
        createCodeSearchTool(),
    ];
}
