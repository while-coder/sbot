/**
 * Tools 模块导出
 * 提供 MCP 标准类型定义
 */
export {
    MCPContentType,
    MCPTextContent,
    MCPImageContent,
    MCPAudioContent,
    MCPImageUrlContent,
    MCPContent,
    MCPToolResult,
    createTextContent,
    createImageContent,
    createAudioContent,
    createSuccessResult,
    createErrorResult,
    isMCPToolResult,
    normalizeToMCPResult,
} from './types';

export {
    createTaskTool,
    type TaskToolParams,
    type RunTaskFn,
} from './TaskTool';

export {
    createAskTool,
    type AskToolParams,
    type AskQuestion,
    type AskResponse,
    type AskUserFn,
    type RadioQuestion,
    type CheckboxQuestion,
    type InputQuestion,
} from './AskTool';
