import { type StructuredToolInterface } from '@langchain/core/tools';

export const SCHEDULER_CREATE_TOOL_NAME = 'scheduler_create' as const;
export const SCHEDULER_DELETE_TOOL_NAME = 'scheduler_delete' as const;
export const SCHEDULER_LIST_TOOL_NAME   = 'scheduler_list'   as const;

/** 仅用于 admin/管理端展示工具 schema 的占位 sessionId，绝不应在运行时被调用 */
export const PREVIEW_TARGET_ID = '__preview__';

export { createSchedulerListTool } from './list';
export { createSchedulerCreateTool } from './create';
export { createSchedulerDeleteTool } from './delete';

import { createSchedulerListTool } from './list';
import { createSchedulerCreateTool } from './create';
import { createSchedulerDeleteTool } from './delete';

export function createSchedulerTools(targetId: string): StructuredToolInterface[] {
    return [
        createSchedulerListTool(targetId),
        createSchedulerCreateTool(targetId),
        createSchedulerDeleteTool(targetId),
    ];
}
