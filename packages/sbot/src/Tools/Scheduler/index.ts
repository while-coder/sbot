import { type StructuredToolInterface } from '@langchain/core/tools';

export const SCHEDULER_CREATE_TOOL_NAME = 'scheduler_create' as const;
export const SCHEDULER_DELETE_TOOL_NAME = 'scheduler_delete' as const;
export const SCHEDULER_LIST_TOOL_NAME   = 'scheduler_list'   as const;

export { createSchedulerListTool } from './list';
export { createSchedulerCreateTool } from './create';
export { createSchedulerDeleteTool } from './delete';

import { createSchedulerListTool } from './list';
import { createSchedulerCreateTool } from './create';
import { createSchedulerDeleteTool } from './delete';

/**
 * @param channelSessionId 创建任务时所在的 channel_session.id（写入 SchedulerRow.channelSessionId 作为投递偏好；触发时若失效再按 profileId 自愈）
 * @param profileId        归属 profile（list/delete 按它过滤；触发用它作为兜底）
 */
export function createSchedulerTools(channelSessionId: number, profileId: number): StructuredToolInterface[] {
    return [
        createSchedulerListTool(profileId),
        createSchedulerCreateTool(channelSessionId, profileId),
        createSchedulerDeleteTool(profileId),
    ];
}
