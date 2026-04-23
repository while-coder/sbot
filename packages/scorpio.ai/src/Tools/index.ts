/**
 * Tools 模块导出
 * 提供 MCP 标准类型定义
 */
export {
    MCPContentType,
    MCPTextContent,
    MCPImageContent,
    MCPAudioContent,
    MCPDocumentContent,
    MCPImageUrlContent,
    MCPContent,
    MCPToolResult,
    createTextContent,
    createImageContent,
    createAudioContent,
    createDocumentContent,
    createSuccessResult,
    createErrorResult,
    isMCPToolResult,
    normalizeToMCPResult,
} from './types';

export {
    createTaskTool,
    TASK_TOOL_NAME,
    type TaskToolParams,
    type RunTaskFn,
} from './TaskTool';

