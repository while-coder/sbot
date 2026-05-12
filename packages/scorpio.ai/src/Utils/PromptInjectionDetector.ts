export enum InjectionSeverity {
    CLEAN = 0,
    WARN = 1,
    BLOCK = 2,
}

export interface DetectionResult {
    severity: InjectionSeverity;
    patterns: string[];
    sanitized: string;
}

interface PatternRule {
    severity: InjectionSeverity;
    description: string;
    regex: RegExp;
}

const BLOCK_PATTERNS: PatternRule[] = [
    { severity: InjectionSeverity.BLOCK, description: "system prompt override: 'ignore previous instructions'", regex: /ignore\s+(all\s+)?previous\s+instructions/gi },
    { severity: InjectionSeverity.BLOCK, description: "system prompt override: 'you are now'", regex: /you\s+are\s+now\s+(?:a|an|the)\s+/gi },
    { severity: InjectionSeverity.BLOCK, description: "system prompt override: 'new system prompt'", regex: /new\s+system\s+prompt/gi },
    { severity: InjectionSeverity.BLOCK, description: "system prompt override: 'disregard'", regex: /disregard\s+(?:all\s+)?(?:previous|prior|above)\s+/gi },
    { severity: InjectionSeverity.BLOCK, description: "role marker: special token injection", regex: /<\|(?:system|im_start|im_end|endoftext)\|>/gi },
    { severity: InjectionSeverity.BLOCK, description: "role marker: line-start SYSTEM:/ASSISTANT:", regex: /^(?:SYSTEM|ASSISTANT|Human|Assistant)\s*:/gm },
    { severity: InjectionSeverity.BLOCK, description: "prompt override: 'forget everything'", regex: /forget\s+everything\s+(?:above|before|previous)/gi },
];

const WARN_PATTERNS: PatternRule[] = [
    { severity: InjectionSeverity.WARN, description: "zero-width Unicode characters", regex: /[​‌‍﻿⁠­]+/g },
    { severity: InjectionSeverity.WARN, description: "HTML comments", regex: /<!--[\s\S]*?-->/g },
    { severity: InjectionSeverity.WARN, description: "base64 in URL (>100 chars)", regex: /https?:\/\/[^\s]*[?&=#][A-Za-z0-9+/]{100,}={0,2}/g },
    { severity: InjectionSeverity.WARN, description: "excessive control characters", regex: /[\x00-\x08\x0B\x0C\x0E-\x1F]{3,}/g },
    { severity: InjectionSeverity.WARN, description: "hidden HTML tags", regex: /<(?:div|span|p|script|style)\s[^>]*(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0)[^>]*>/gi },
];

const ALL_PATTERNS: PatternRule[] = [...BLOCK_PATTERNS, ...WARN_PATTERNS];

export class PromptInjectionDetector {
    detect(content: string): DetectionResult {
        let maxSeverity = InjectionSeverity.CLEAN;
        const detected: string[] = [];
        let sanitized = content;

        for (const rule of ALL_PATTERNS) {
            if (rule.regex.test(content)) {
                detected.push(rule.description);
                if (rule.severity > maxSeverity) maxSeverity = rule.severity;
                // 重置 regex lastIndex（全局标志的 regex 需要重置）
                rule.regex.lastIndex = 0;
                sanitized = sanitized.replace(rule.regex, '');
                rule.regex.lastIndex = 0;
            }
            rule.regex.lastIndex = 0;
        }

        return { severity: maxSeverity, patterns: detected, sanitized: sanitized.trim() };
    }

    sanitize(content: string): string {
        return this.detect(content).sanitized;
    }
}
