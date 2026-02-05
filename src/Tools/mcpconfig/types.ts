/**
 * MCP 标准内容类型定义
 * 基于 @modelcontextprotocol/sdk 的类型定义
 */

/**
 * MCP 文本内容
 */
export type MCPTextContent = {
    type: "text";
    text: string;
};

/**
 * MCP 图片内容
 */
export type MCPImageContent = {
    type: "image";
    data: string;
    mimeType: string;
};

/**
 * MCP 音频内容
 */
export type MCPAudioContent = {
    type: "audio";
    data: string;
    mimeType: string;
};

/**
 * MCP 内容块（联合类型）
 */
export type MCPContent = MCPTextContent | MCPImageContent | MCPAudioContent;

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
    return { type: "text", text };
}

/**
 * 创建图片内容块
 */
export function createImageContent(data: string, mimeType: string = "image/png"): MCPImageContent {
    return { type: "image", data, mimeType };
}

/**
 * 创建音频内容块
 */
export function createAudioContent(data: string, mimeType: string = "audio/mpeg"): MCPAudioContent {
    return { type: "audio", data, mimeType };
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
        content: [{ type: "text", text: errorMessage }],
        isError: true
    };
}