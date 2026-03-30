import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import TurndownService from 'turndown'
import { createTextContent, createErrorResult, createSuccessResult, type MCPToolResult } from 'scorpio.ai'
import { loadPrompt } from '../../Core/PromptLoader'
import { LoggerService } from '../../Core/LoggerService'

const logger = LoggerService.getLogger('Tools/Web/webfetch.ts')

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024  // 5MB
const MAX_OUTPUT_SIZE   = 20000            // 20000 chars
const DEFAULT_TIMEOUT_SEC = 30
const MAX_TIMEOUT_MS = 120 * 1000

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
        name: 'web_fetch',
        description: loadPrompt('tools/web/fetch.txt'),
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

                const response =
                    initial.status === 403 && initial.headers.get('cf-mitigated') === 'challenge'
                        ? await fetch(url, { signal: controller.signal, headers: { ...headers, 'User-Agent': 'sbot' } })
                        : initial

                if (!response.ok) {
                    return createErrorResult(`Request failed with status code: ${response.status}`)
                }

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

                const isImage =
                    mime.startsWith('image/') &&
                    mime !== 'image/svg+xml' &&
                    mime !== 'image/vnd.fastbidsheet'

                if (isImage) {
                    const base64Content = Buffer.from(arrayBuffer).toString('base64')
                    return createSuccessResult(
                        createTextContent(
                            `size: ${arrayBuffer.byteLength} bytes\nbase64: data:${mime};base64,${base64Content}`,
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
                    ? output.slice(0, MAX_OUTPUT_SIZE) + `\n\n(Content truncated at ${MAX_OUTPUT_SIZE} characters.)`
                    : output
                return createSuccessResult(createTextContent(finalOutput))
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
