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
    MCPToolResultMeta,
    createTextContent,
    createImageContent,
    createAudioContent,
    createDocumentContent,
    createSuccessResult,
    createErrorResult,
    isMCPToolResult,
    normalizeToMCPResult,
} from './Core/types';

export {
    createDispatchTaskTool,
    DISPATCH_TASK_TOOL_NAME,
    TaskContextMode,
    type DispatchTaskToolParams,
    type RunDispatchTaskFn,
    createListTasksTool,
    LIST_TASKS_TOOL_NAME,
    TaskStatus,
    type TaskInfo,
    type GetTasksFn,
} from './Task';

export {
    runProgram,
    runShellCommand,
    resolveShell,
    isCommandAvailable,
    validatePath,
    resolveWorkingDir,
    createScriptCodeTool,
    scriptCodeSchema,
    ScriptCodeMode,
    type ScriptCodeToolOptions,
    ShellManager,
    formatBackgroundResult,
    MAX_OUTPUT_BYTES,
} from './Process';

export {
    walkTree,
    formatWalkSummary,
    formatWalkTree,
    DEFAULT_WALK_MAX_DEPTH,
    DEFAULT_WALK_LIMIT,
    type WalkTreeOptions,
    type WalkTreeResult,
} from './walkTree';

export {
    truncateMCPToolResult,
    type TruncateToolResultOptions,
} from './Core/truncateToolResult';

