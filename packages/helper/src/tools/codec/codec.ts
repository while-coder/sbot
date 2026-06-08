/**
 * 编解码工具集（纯前端实现）
 * - 字符串 ↔ Base64 / Hex
 * - URL encode / decode
 * - HTML / Unicode 转义
 * - JSON 美化 / 压缩
 * - 哈希：MD5（内置）/ SHA-1 / SHA-256 / SHA-512（Web Crypto）
 * - 文件 ↔ Base64
 */

// ===== Base64 =====
export function stringToBase64(text: string): string {
    const bytes = new TextEncoder().encode(text)
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    return btoa(binary)
}

export function base64ToString(b64: string): string {
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder().decode(bytes)
}

export function base64ToBytes(b64: string): Uint8Array {
    const binary = atob(b64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
}

export function base64ToBase64Url(b64: string): string {
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlToBase64(url: string): string {
    const pad = url.length % 4 === 0 ? 0 : 4 - (url.length % 4)
    return url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad)
}

// ===== Hex =====
export function stringToHex(text: string): string {
    return [...new TextEncoder().encode(text)]
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
}

export function hexToString(hex: string): string {
    const clean = hex.replace(/\s+/g, '')
    if (clean.length % 2 !== 0) throw new Error('Invalid hex length')
    const bytes = new Uint8Array(clean.length / 2)
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
    }
    return new TextDecoder().decode(bytes)
}

export function bytesToHex(bytes: Uint8Array): string {
    return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('')
}

// ===== URL =====
export function urlEncode(text: string): string {
    return encodeURIComponent(text)
}

export function urlDecode(text: string): string {
    return decodeURIComponent(text)
}

// ===== HTML =====
export function htmlEncode(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
}

export function htmlDecode(text: string): string {
    return text
        .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
}

// ===== Unicode =====
export function unicodeEscape(text: string): string {
    let out = ''
    for (const ch of text) {
        const code = ch.codePointAt(0)!
        if (code < 0x80) out += ch
        else if (code <= 0xffff) out += '\\u' + code.toString(16).padStart(4, '0')
        else out += '\\u{' + code.toString(16) + '}'
    }
    return out
}

export function unicodeUnescape(text: string): string {
    return text
        .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
        .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

// ===== JSON =====
export function jsonFormat(input: string, indent: number = 2): string {
    return JSON.stringify(JSON.parse(input), null, indent)
}

export function jsonMinify(input: string): string {
    return JSON.stringify(JSON.parse(input))
}

// ===== UUID =====
export function uuid(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = (Math.random() * 16) | 0
        const v = c === 'x' ? r : (r & 0x3) | 0x8
        return v.toString(16)
    })
}

// ===== 时间戳 =====
export function dateToUnixSeconds(date: Date = new Date()): number {
    return Math.floor(date.getTime() / 1000)
}

export function unixSecondsToDate(seconds: number): Date {
    return new Date(seconds * 1000)
}

// ===== 字节大小 =====
export function formatBytes(bytes: number, decimals: number = 2): string {
    if (!Number.isFinite(bytes) || bytes < 0) return '0 B'
    if (bytes < 1024) return `${bytes} B`
    const units = ['KB', 'MB', 'GB', 'TB', 'PB']
    let v = bytes / 1024
    let i = 0
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
    return `${v.toFixed(decimals)} ${units[i]}`
}

// ===== 哈希 =====
export type HashAlgorithm = 'md5' | 'sha1' | 'sha256' | 'sha512'

const SHA_NAME: Record<Exclude<HashAlgorithm, 'md5'>, string> = {
    sha1: 'SHA-1',
    sha256: 'SHA-256',
    sha512: 'SHA-512',
}

export async function hashBytes(bytes: Uint8Array, algorithm: HashAlgorithm): Promise<string> {
    if (algorithm === 'md5') return md5Bytes(bytes)
    const view = new Uint8Array(bytes.byteLength)
    view.set(bytes)
    const buf = await crypto.subtle.digest(SHA_NAME[algorithm], view.buffer)
    return bytesToHex(new Uint8Array(buf))
}

export async function hashString(text: string, algorithm: HashAlgorithm = 'md5'): Promise<string> {
    return hashBytes(new TextEncoder().encode(text), algorithm)
}

export async function hashFile(file: File, algorithm: HashAlgorithm = 'md5'): Promise<string> {
    const buf = await file.arrayBuffer()
    return hashBytes(new Uint8Array(buf), algorithm)
}

// MD5（RFC 1321）
function md5Bytes(input: Uint8Array): string {
    const len = input.length
    const totalLen = (((len + 8) >>> 6) + 1) << 6
    const buf = new Uint8Array(totalLen)
    buf.set(input)
    buf[len] = 0x80
    const bitLen = len * 8
    buf[totalLen - 8] = bitLen & 0xff
    buf[totalLen - 7] = (bitLen >>> 8) & 0xff
    buf[totalLen - 6] = (bitLen >>> 16) & 0xff
    buf[totalLen - 5] = (bitLen >>> 24) & 0xff

    let a = 0x67452301, b = 0xefcdab89, c = 0x98badcfe, d = 0x10325476
    const K = [
        0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a,
        0xa8304613, 0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
        0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340,
        0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
        0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8,
        0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
        0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
        0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
        0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92,
        0xffeff47d, 0x85845dd1, 0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
        0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
    ]
    const S = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ]
    function rotl(x: number, n: number): number { return ((x << n) | (x >>> (32 - n))) >>> 0 }

    const M = new Int32Array(16)
    for (let off = 0; off < totalLen; off += 64) {
        for (let i = 0; i < 16; i++) {
            const j = off + i * 4
            M[i] = buf[j] | (buf[j + 1] << 8) | (buf[j + 2] << 16) | (buf[j + 3] << 24)
        }
        let A = a, B = b, C = c, D = d
        for (let i = 0; i < 64; i++) {
            let F: number, g: number
            if (i < 16) { F = (B & C) | (~B & D); g = i }
            else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16 }
            else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16 }
            else { F = C ^ (B | ~D); g = (7 * i) % 16 }
            const tmp = D
            D = C
            C = B
            B = (B + rotl((A + F + K[i] + M[g]) >>> 0, S[i])) >>> 0
            A = tmp
        }
        a = (a + A) >>> 0
        b = (b + B) >>> 0
        c = (c + C) >>> 0
        d = (d + D) >>> 0
    }

    function toHex(n: number): string {
        let s = ''
        for (let i = 0; i < 4; i++) {
            s += ((n >>> (i * 8)) & 0xff).toString(16).padStart(2, '0')
        }
        return s
    }
    return toHex(a) + toHex(b) + toHex(c) + toHex(d)
}

// ===== 文件 ↔ Base64 =====
export function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const result = reader.result as string
            const idx = result.indexOf(',')
            resolve(idx >= 0 ? result.slice(idx + 1) : result)
        }
        reader.onerror = () => reject(reader.error)
        reader.readAsDataURL(file)
    })
}

export function downloadBase64(b64: string, filename: string, mimeType: string = 'application/octet-stream'): void {
    const bytes = base64ToBytes(b64)
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    const blob = new Blob([copy], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}

export function downloadText(text: string, filename: string, mimeType: string = 'text/plain;charset=utf-8'): void {
    const blob = new Blob([text], { type: mimeType })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
}
