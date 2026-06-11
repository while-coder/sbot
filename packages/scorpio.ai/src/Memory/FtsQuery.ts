/**
 * 把自由文本切成 FTS5 MATCH 表达式。
 *
 * 移植自 MiMo Memory（packages/opencode/src/memory/fts-query.ts）。
 *
 * 设计要点：
 * - FTS5 MATCH 语法对 `"`、`(`、`*`、`:` 等特殊字符敏感，原始用户字符串直接喂会崩 parser。
 *   把每个 token 用 phrase quote 包起来再 OR-join，可以绕过所有特殊字符问题。
 * - 用 OR 而非 AND：AND 要求每个词都命中，长查询里只要一个词没存就归零；OR 让 BM25
 *   按"命中几个 / 多稀有"排序，配合调用方的 score floor 把 common-word 噪音过滤掉。
 * - `\p{L}` 包含 CJK 字符，中文也能 tokenize。
 *
 * 返回 null 表示提不出有效 token，调用方应直接当"空查询，0 结果"，不要喂给 SQL。
 */
export function buildFtsQuery(raw: string): string | null {
    const tokens =
        raw
            .match(/[\p{L}\p{N}_]+/gu)
            ?.map(t => t.trim())
            .filter(Boolean) ?? [];
    if (tokens.length === 0) return null;
    const quoted = tokens.map(t => `"${t.replaceAll('"', "")}"`);
    return quoted.join(" OR ");
}
