/**
 * 喂给 LLM 之前的密钥兜底正则替换。
 *
 * 模型并不总能识别所有 token 形态——尤其是用户粘贴的环境变量、cURL、配置文件片段。
 * 本类做最后一道防线：在 prompt 渲染好之后、提交给模型之前，正则扫一遍。
 *
 * 设计取舍：
 * - 只覆盖已知前缀的 token（OpenAI / Anthropic / GitHub / Slack / AWS / Google / JWT / PEM 私钥）
 * - 不做"高熵字符串"那种启发式判断（误伤真实代码片段成本太高，比如 SHA-1）
 * - 替换文本统一用 `[REDACTED_SECRET]`
 */
export class SecretRedactor {
    private static readonly DEFAULT_PATTERNS: ReadonlyArray<RegExp> = [
        // OpenAI API keys（含 project/org 前缀变体）
        /sk-(?:proj-|admin-|svcacct-)?[A-Za-z0-9_-]{20,}/g,
        // Anthropic API keys
        /sk-ant-[A-Za-z0-9_-]{32,}/g,
        // GitHub tokens（PAT / OAuth / app / refresh）
        /(?:gh[psuoeir]|github_pat)_[A-Za-z0-9_]{20,}/g,
        // Slack tokens
        /xox[baprseo]-[A-Za-z0-9-]{8,}/g,
        // AWS access key id
        /\bAKIA[0-9A-Z]{16}\b/g,
        // Google API key
        /\bAIza[0-9A-Za-z_-]{35}\b/g,
        // JWT (3-segment base64url)
        /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{8,}\b/g,
        // PEM 私钥
        /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY( BLOCK)?-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY( BLOCK)?-----/g,
    ];

    private readonly patterns: ReadonlyArray<RegExp>;

    constructor(extra: ReadonlyArray<RegExp> = []) {
        this.patterns = [...SecretRedactor.DEFAULT_PATTERNS, ...extra];
    }

    redact(text: string): string {
        let result = text;
        for (const pattern of this.patterns) {
            result = result.replace(pattern, "[REDACTED_SECRET]");
        }
        return result;
    }
}
