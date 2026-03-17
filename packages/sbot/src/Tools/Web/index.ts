/**
 * Web 内容抓取 & 文件下载工具集
 * - webfetch: 抓取网页内容，支持 HTML→Markdown/Text 转换
 * - webdownload: 流式下载文件到本地，自动重试
 */

import fs from 'fs'
import path from 'path'
import http from 'http'
import https from 'https'
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import TurndownService from 'turndown'
import axios from 'axios'
import { createTextContent, createErrorResult, createSuccessResult, type MCPToolResult } from 'scorpio.ai'
import { LoggerService } from '../../Core/LoggerService'

const logger = LoggerService.getLogger('Tools/Web/index.ts')

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024  // 5MB — HTTP 响应上限，超出直接拒绝
const MAX_OUTPUT_SIZE   = 3000             // 3000 字符 — 返回给 LLM 的内容上限，超出截断
const DEFAULT_TIMEOUT_SEC = 30             // 30 seconds
const MAX_TIMEOUT_MS = 120 * 1000          // 2 minutes

/**
 * 从 HTML 字符串中提取纯文本，跳过 script/style 等不可见元素内容。
 * 使用正则替代 HTMLRewriter（Cloudflare Workers API，Node.js 不可用）。
 */
function extractTextFromHTML(html: string): string {
    return html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
        .replace(/<iframe[\s\S]*?<\/iframe>/gi, ' ')
        .replace(/<object[\s\S]*?<\/object>/gi, ' ')
        .replace(/<embed[\s\S]*?<\/embed>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim()
}

function convertHTMLToMarkdown(html: string): string {
    const turndownService = new TurndownService({
        headingStyle: 'atx',
        hr: '---',
        bulletListMarker: '-',
        codeBlockStyle: 'fenced',
        emDelimiter: '*',
    })
    turndownService.remove(['script', 'style', 'meta', 'link'])
    return turndownService.turndown(html)
}

export function createWebFetchTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'webfetch',
        description: `Fetch and read content from a web URL. Supports HTML→Markdown conversion, plain-text extraction, or raw HTML output.

Parameters:
- url: Full URL starting with http:// or https://
- format: "markdown" (default, HTML converted to Markdown) | "text" (HTML stripped to plain text) | "html" (raw HTML)
- timeout: Optional timeout in seconds (max 120, default 30)

Use this tool to retrieve documentation, articles, API references, or any web resource.`,
        schema: z.object({
            url: z.string().describe('The URL to fetch content from (must start with http:// or https://)'),
            format: z
                .enum(['text', 'markdown', 'html'])
                .default('markdown')
                .describe('The format to return the content in. Defaults to markdown.'),
            timeout: z.number().optional().describe('Optional timeout in seconds (max 120, default 30)'),
        }) as any,
        func: async ({ url, format = 'markdown', timeout: timeoutSec }: any): Promise<MCPToolResult> => {
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                return createErrorResult('URL must start with http:// or https://')
            }

            const timeoutMs = Math.min((timeoutSec ?? DEFAULT_TIMEOUT_SEC) * 1000, MAX_TIMEOUT_MS)
            const controller = new AbortController()
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

            // Build Accept header based on requested format with q parameters for fallbacks
            let acceptHeader = '*/*'
            switch (format) {
                case 'markdown':
                    acceptHeader = 'text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1'
                    break
                case 'text':
                    acceptHeader = 'text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1'
                    break
                case 'html':
                    acceptHeader = 'text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, text/markdown;q=0.7, */*;q=0.1'
                    break
            }

            const headers = {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                Accept: acceptHeader,
                'Accept-Language': 'en-US,en;q=0.9',
            }

            try {
                const initial = await fetch(url, { signal: controller.signal, headers })

                // Retry with honest UA if blocked by Cloudflare bot detection (TLS fingerprint mismatch)
                const response =
                    initial.status === 403 && initial.headers.get('cf-mitigated') === 'challenge'
                        ? await fetch(url, { signal: controller.signal, headers: { ...headers, 'User-Agent': 'sbot' } })
                        : initial

                if (!response.ok) {
                    return createErrorResult(`Request failed with status code: ${response.status}`)
                }

                // Check content length before downloading
                const contentLength = response.headers.get('content-length')
                if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
                    return createErrorResult('Response too large (exceeds 5MB limit)')
                }

                const arrayBuffer = await response.arrayBuffer()
                if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
                    return createErrorResult('Response too large (exceeds 5MB limit)')
                }

                const contentType = response.headers.get('content-type') || ''
                const mime = contentType.split(';')[0]?.trim().toLowerCase() || ''
                const title = `${url} (${contentType})`

                // Handle image content
                const isImage =
                    mime.startsWith('image/') &&
                    mime !== 'image/svg+xml' &&
                    mime !== 'image/vnd.fastbidsheet'

                if (isImage) {
                    const base64Content = Buffer.from(arrayBuffer).toString('base64')
                    return createSuccessResult(
                        createTextContent(
                            `${title}\n\nImage fetched successfully.\ndata:${mime};base64,${base64Content}`,
                        ),
                    )
                }

                const content = new TextDecoder().decode(arrayBuffer)
                let output: string

                switch (format) {
                    case 'markdown':
                        output = contentType.includes('text/html')
                            ? convertHTMLToMarkdown(content)
                            : content
                        break
                    case 'text':
                        output = contentType.includes('text/html')
                            ? extractTextFromHTML(content)
                            : content
                        break
                    case 'html':
                    default:
                        output = content
                        break
                }

                const truncated = output.length > MAX_OUTPUT_SIZE
                const finalOutput = truncated
                    ? output.slice(0, MAX_OUTPUT_SIZE) + `\n\n[内容已截断，超过 ${MAX_OUTPUT_SIZE} 字符限制]`
                    : output
                return createSuccessResult(createTextContent(`${title}\n\n${finalOutput}`))
            } catch (err: any) {
                if (err.name === 'AbortError') {
                    return createErrorResult(`Request timed out after ${timeoutMs / 1000} seconds: ${url}`)
                }
                logger.error(`WebFetch error for ${url}: ${err.message}`)
                return createErrorResult(`Failed to fetch ${url}: ${err.message}`)
            } finally {
                clearTimeout(timeoutId)
            }
        },
    })
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function createWebDownloadTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'webdownload',
        description: `Download a file from a URL and save it to a local absolute path. Streams large files directly to disk without loading into memory. Automatically retries on network errors with exponential backoff. Parent directories are created automatically.

Parameters:
- url: Full URL starting with http:// or https://
- savePath: Absolute path where the file will be saved
- timeout: Optional timeout in seconds (default 300, max 600)
- maxRetries: Optional number of retry attempts on failure (default 3)`,
        schema: z.object({
            url: z.string().describe('The URL to download from (must start with http:// or https://)'),
            savePath: z.string().describe('Absolute local path to save the downloaded file'),
            timeout: z.number().optional().describe('Timeout in seconds (default 300, max 600)'),
            maxRetries: z.number().optional().describe('Retry attempts on network failure (default 3)'),
        }) as any,
        func: async ({ url, savePath, timeout: timeoutSec, maxRetries = 3 }: any): Promise<MCPToolResult> => {
            if (!url.startsWith('http://') && !url.startsWith('https://')) {
                return createErrorResult('URL must start with http:// or https://')
            }
            if (!path.isAbsolute(savePath)) {
                return createErrorResult(`savePath must be an absolute path: ${savePath}`)
            }

            const timeoutMs = Math.min((timeoutSec ?? 300) * 1000, 600 * 1000)
            const normalizedPath = path.normalize(savePath)

            try {
                fs.mkdirSync(path.dirname(normalizedPath), { recursive: true })
            } catch (err: any) {
                return createErrorResult(`Failed to create directory: ${err.message}`)
            }

            logger.info(`Starting download: ${url} -> ${normalizedPath}`)

            let lastError: Error | null = null

            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                if (attempt > 1) {
                    const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
                    logger.info(`Retry ${attempt}/${maxRetries}, waiting ${delay}ms...`)
                    await new Promise(resolve => setTimeout(resolve, delay))
                }

                try {
                    const response = await axios({
                        method: 'GET',
                        url,
                        responseType: 'stream',
                        timeout: timeoutMs,
                        maxContentLength: Infinity,
                        maxBodyLength: Infinity,
                        httpAgent: new http.Agent({ keepAlive: true, keepAliveMsecs: 30000 }),
                        httpsAgent: new https.Agent({ keepAlive: true, keepAliveMsecs: 30000 }),
                    })

                    const totalBytes: number = parseInt(response.headers['content-length'] || '0', 10)
                    let downloaded = 0

                    const writer = fs.createWriteStream(normalizedPath)

                    response.data.on('data', (chunk: Buffer) => {
                        downloaded += chunk.length
                        if (totalBytes > 0) {
                            const percent = (downloaded / totalBytes * 100).toFixed(1)
                            logger.info(`Download progress: ${percent}% (${formatBytes(downloaded)}/${formatBytes(totalBytes)})`)
                        } else {
                            logger.info(`Downloaded: ${formatBytes(downloaded)}`)
                        }
                    })

                    response.data.pipe(writer)

                    await new Promise<void>((resolve, reject) => {
                        writer.on('finish', resolve)
                        writer.on('error', (err) => { writer.destroy(); reject(err) })
                        response.data.on('error', (err: Error) => { writer.destroy(); reject(err) })
                    })

                    const stats = fs.statSync(normalizedPath)
                    logger.info(`Download complete: ${normalizedPath} (${formatBytes(stats.size)})`)
                    return createSuccessResult(
                        createTextContent(
                            `Downloaded successfully: ${normalizedPath}\nSize: ${formatBytes(stats.size)}\nSource: ${url}`,
                        ),
                    )
                } catch (err: any) {
                    lastError = err
                    const errorMsg =
                        err.code === 'ECONNRESET' ? 'Connection reset' :
                        err.code === 'ETIMEDOUT'  ? 'Connection timed out' :
                        err.message
                    logger.error(`Download failed (attempt ${attempt}/${maxRetries}): ${errorMsg}`)

                    // Clean up incomplete file
                    if (fs.existsSync(normalizedPath)) {
                        try { fs.unlinkSync(normalizedPath) } catch { /* ignore */ }
                    }
                }
            }

            return createErrorResult(
                `Download failed after ${maxRetries} attempt(s). Last error: ${lastError?.message}\nURL: ${url}`,
            )
        },
    })
}

export function createWebFetchTools(): StructuredToolInterface[] {
    return [createWebFetchTool(), createWebDownloadTool()]
}
