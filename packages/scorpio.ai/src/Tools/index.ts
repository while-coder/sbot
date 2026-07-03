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
    getCurrentShell,
    isCommandAvailable,
    validatePath,
    resolveWorkingDir,
    createShellTool,
    createReadProcessTool,
    shellToolSchema,
    readProcessToolSchema,
    CodeRuntime,
    CodeToolMode,
    ShellToolMode,
    ScriptCodeMode,
    type ShellToolOptions,
    type ReadProcessToolOptions,
    createScriptCodeTool,
    scriptCodeSchema,
    type ScriptCodeToolOptions,
    ProcessManager,
    processManager,
    formatProcessResult,
    type ManagedProcessResult,
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
} from './Core/walkTree';

export {
    truncateMCPToolResult,
    type TruncateToolResultOptions,
} from './Core/truncateToolResult';

