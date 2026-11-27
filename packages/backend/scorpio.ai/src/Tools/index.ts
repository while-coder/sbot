/**
 * Tools 模块导出
 * 提供 MCP 标准定义与通用工具能力
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
    MCPToolResultMeta,
    createTextContent,
    createImageContent,
    createAudioContent,
    createDocumentContent,
    createSuccessResult,
    createErrorResult,
    isMCPToolResult,
    normalizeToMCPResult,
} from './Core/mcp';

export {
    createSpawnAgentTool,
    SPAWN_AGENT_TOOL_NAME,
    TaskContextMode,
    type DispatchTaskToolParams,
    type RunDispatchTaskArgs,
    type RunDispatchTaskFn,
} from './Task';

export {
    walkTree,
    formatWalkSummary,
    formatWalkTree,
    DEFAULT_WALK_MAX_DEPTH,
    DEFAULT_WALK_LIMIT,
    type WalkTreeOptions,
    type WalkTreeResult,
} from './Core/walkTree';

export {
    truncateMCPToolResult,
    type TruncateToolResultOptions,
} from './Core/truncateToolResult';

