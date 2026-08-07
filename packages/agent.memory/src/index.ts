/** Long-term Memory capability plugin。 */

export * from './tokens';
export * from './prompts';

// ── Storage ──
export {
    IMemoryStore,
    MemoryKind,
    MemoryScope,
    type MemoryBodyMode,
    type StoredMemoryRow,
    type MemoryRow,
    type StoredMemoryMenuEntry,
    type MemoryMenuEntry,
    type StoredMemorySearchHit,
    type MemorySearchHit,
    type CreateMemoryInput,
    type UpdateMemoryInput,
    MemoryPendingJobType,
    type PendingMemoryJobRow,
    type MemoryPendingJobStatus,
    type MemoryWorkspaceScope,
    type MemoryTarget,
} from './Storage/IMemoryStore';
export { MemoryStore } from './Storage/MemoryStore';

// ── Service（含 LLM 抽取与 transcript 渲染） ──
export {
    IMemoryService,
    type MemoryToolDescs,
    type MemoryWriterOpStats,
} from './Service/IMemoryService';
export {
    MemoryService,
    MemoryOpAction,
    MemoryOpSchema,
    MemoryWriteOutputSchema,
    type MemoryWriteOutput,
    type MemoryOp,
} from './Service/MemoryService';
export { GlobalMemoryService } from './Service/GlobalMemoryService';
export { ScopedMemoryService } from './Service/ScopedMemoryService';
export {
    MemoryServicePool,
    memoryServicePool,
    type MemoryServiceConfig,
    type MemoryServiceConfigResolver,
} from './Service/MemoryServicePool';

// ── Agent plugin ──
export { MemoryAgentPlugin } from './Plugin/MemoryAgentPlugin';
export { MemoryPluginLease } from './Plugin/MemoryPluginLease';

// ── Tools ──
export {
    MemoryToolProvider,
    READ_MEMORY_TOOL_NAME,
    SEARCH_MEMORY_TOOL_NAME,
    REMEMBER_MEMORY_TOOL_NAME,
} from './Tools/MemoryToolProvider';
