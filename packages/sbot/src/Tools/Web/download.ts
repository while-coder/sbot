import fs from 'fs'
import path from 'path'
import http from 'http'
import https from 'https'
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools'
import { z } from 'zod'
import axios from 'axios'
import { createTextContent, createErrorResult, createSuccessResult, type MCPToolResult } from 'scorpio.ai'
import { loadPrompt } from '../../Core/PromptLoader'
import { LoggerService } from '../../Core/LoggerService'

const logger = LoggerService.getLogger('Tools/Web/webdownload.ts')

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function createWebDownloadTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'web_download',
        description: loadPrompt('tools/web/download.txt'),
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
