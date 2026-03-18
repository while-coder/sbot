/**
 * MCP 标准内容类型定义
 * 基于 @modelcontextprotocol/sdk 的类型定义，扩展支持 OpenAI 格式
 */

/**
 * 内容类型枚举
 */
export enum MCPContentType {
    Text = "text",
    Image = "image",
    Audio = "audio",
    ImageUrl = "image_url",  // OpenAI 格式支持
}

/**
 * MCP 文本内容
 */
export type MCPTextContent = {
    type: MCPContentType.Text;
    text: string;
};

/**
 * MCP 图片内容
 */
export type MCPImageContent = {
    type: MCPContentType.Image;
    data: string;
    mimeType: string;
};

/**
 * MCP 音频内容
 */
export type MCPAudioContent = {
    type: MCPContentType.Audio;
    data: string;
    mimeType: string;
};

/**
 * OpenAI 风格的图片 URL 内容
 * 支持 url 或 image_url 字段名
 */
export type MCPImageUrlContent = {
    type: MCPContentType.ImageUrl;
} & (
    | { url: string | { url: string }; image_url?: never }
    | { image_url: string | { url: string }; url?: never }
);

/**
 * MCP 内容块（联合类型）
 */
export type MCPContent = MCPTextContent | MCPImageContent | MCPAudioContent | MCPImageUrlContent;

/**
 * MCP 工具调用结果
 */
export type MCPToolResult = {
    content: MCPContent[];
    isError?: boolean;
};

/**
 * 创建文本内容块
 */
export function createTextContent(text: string): MCPTextContent {
    return { type: MCPContentType.Text, text };
}

/**
 * 创建图片内容块
 */
export function createImageContent(data: string, mimeType: string = "image/png"): MCPImageContent {
    return { type: MCPContentType.Image, data, mimeType };
}

/**
 * 创建音频内容块
 */
export function createAudioContent(data: string, mimeType: string = "audio/mpeg"): MCPAudioContent {
    return { type: MCPContentType.Audio, data, mimeType };
}

/**
 * 创建成功的 MCP 工具结果
 */
export function createSuccessResult(...contents: MCPContent[]): MCPToolResult {
    return { content: contents };
}

/**
 * 创建错误的 MCP 工具结果
 */
export function createErrorResult(errorMessage: string): MCPToolResult {
    return {
        content: [{ type: MCPContentType.Text, text: errorMessage }],
        isError: true
    };
}

/**
 * 类型守卫：检查一个值是否为有效的 MCP 工具结果
 * @param value 要检查的值
 * @returns 如果是有效的 MCPToolResult 返回 true
 */
export function isMCPToolResult(value: any): value is MCPToolResult {
    return value && typeof value === "object" && "content" in value && Array.isArray(value.content);
}

/**
 * 尝试将各种格式转换为 MCP 标准格式
 * @param result 工具返回的结果
 * @returns MCP 格式的工具结果
 */
export function normalizeToMCPResult(result: any): MCPToolResult {
    // 1. 已经是 MCP 格式
    if (isMCPToolResult(result)) {
        return result;
    }

    // 2. 数组格式（包括 OpenAI 风格），直接包装
    if (Array.isArray(result)) {
        return {
            content: result
        };
    }

    // 3. 字符串，转换为文本内容
    if (typeof result === "string") {
        return {
            content: [{ type: MCPContentType.Text, text: result }]
        };
    }

    // 4. 其他对象，JSON 序列化为文本
    return {
        content: [{ type: MCPContentType.Text, text: JSON.stringify(result) }]
    };
}
