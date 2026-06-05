import * as fs from 'fs/promises';
import * as path from 'path';
import { MCPContentType, type MCPContent, type MCPToolResult } from './types';

const MAX_BYTES = 32 * 1024;

export interface TruncateToolResultOptions {
    spillDir: string;
    toolCallId: string;
    toolName: string;
}

/**
 * 对单条 tool result 中的文本块做 head+tail 截断；超限部分整段写入 spillDir
 * 下的临时文件，截断标记中带上文件绝对路径，便于人工/工具回查。
 *
 * - 仅处理 MCPContentType.Text 块；image/audio/document 块原样保留
 * - 单个 text 块字节数 ≤ MAX_BYTES 时不动
 * - 落盘失败时降级为不带路径的截断，保证主链路不中断
 */
export async function truncateMCPToolResult(
    result: MCPToolResult,
    opts: TruncateToolResultOptions,
): Promise<MCPToolResult> {
    let touched = false;
    const newContent: MCPContent[] = [];
    let textBlockIdx = 0;

    for (const block of result.content) {
        if (block.type !== MCPContentType.Text) {
            newContent.push(block);
            continue;
        }
        // 防御：normalizeToMCPResult 在某些边界（比如 tool 返回 undefined）会把 text 写成非 string；
        // Buffer.byteLength(undefined) 会抛 TypeError，这里直接跳过让外层逻辑去处理即可。
        if (typeof block.text !== 'string') {
            newContent.push(block);
            textBlockIdx++;
            continue;
        }
        const fullText = block.text;
        const fullLen = Buffer.byteLength(fullText, 'utf8');
        if (fullLen <= MAX_BYTES) {
            newContent.push(block);
            textBlockIdx++;
            continue;
        }

        const filename = `${sanitizeName(opts.toolName)}-${sanitizeName(opts.toolCallId)}-${textBlockIdx}.txt`;
        const filePath = path.join(opts.spillDir, filename);
        let spillNote: string;
        try {
            await fs.writeFile(filePath, fullText, 'utf8');
            spillNote = `full output saved to ${filePath}`;
        } catch (err: any) {
            spillNote = `spill failed: ${err?.message ?? err}`;
        }

        newContent.push({
            type: MCPContentType.Text,
            text: headTailWithMarker(fullText, fullLen, MAX_BYTES, spillNote),
        });
        touched = true;
        textBlockIdx++;
    }

    if (!touched) return result;
    return { ...result, content: newContent };
}

function headTailWithMarker(text: string, fullLen: number, maxBytes: number, note: string): string {
    // 上界估算：所有数字都用 fullLen 占位，实际 marker 一定 ≤ 这个长度（其他三个数都 ≤ fullLen）
    const markerEstimate = `\n\n…[truncated: bytes ${fullLen}..${fullLen} of ${fullLen} omitted (${fullLen} bytes); ${note}]…\n\n`;
    const markerLen = Buffer.byteLength(markerEstimate, 'utf8');
    const budget = Math.max(0, maxBytes - markerLen);
    const headBudget = Math.floor(budget / 2);
    const tailBudget = budget - headBudget;

    const head = takeBytesFromStart(text, headBudget);
    const tail = takeBytesFromEnd(text, tailBudget);
    const headBytes = Buffer.byteLength(head, 'utf8');
    const tailBytes = Buffer.byteLength(tail, 'utf8');
    const omitted = fullLen - headBytes - tailBytes;
    const tailStart = fullLen - tailBytes;
    // 暴露字节区间，方便有 read_file 工具的 LLM 直接 offset=headBytes、limit=omitted 精准捞缺失部分
    const marker = `\n\n…[truncated: bytes ${headBytes}..${tailStart} of ${fullLen} omitted (${omitted} bytes); ${note}]…\n\n`;
    return head + marker + tail;
}

// 按字节截取并对齐到 UTF-8 字符边界（避免出现半截多字节字符）
function takeBytesFromStart(text: string, maxBytes: number): string {
    if (maxBytes <= 0) return '';
    const buf = Buffer.from(text, 'utf8');
    if (buf.length <= maxBytes) return text;
    let end = maxBytes;
    while (end > 0 && (buf[end] & 0xC0) === 0x80) end--;
    return buf.slice(0, end).toString('utf8');
}

function takeBytesFromEnd(text: string, maxBytes: number): string {
    if (maxBytes <= 0) return '';
    const buf = Buffer.from(text, 'utf8');
    if (buf.length <= maxBytes) return text;
    let start = buf.length - maxBytes;
    while (start < buf.length && (buf[start] & 0xC0) === 0x80) start++;
    return buf.slice(start).toString('utf8');
}

function sanitizeName(s: string): string {
    return (s || 'unknown').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 64);
}
