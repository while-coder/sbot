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

export function createSchedulerTools(schedulerType: string, schedulerId: string): StructuredToolInterface[] {
    return [
        createSchedulerListTool(schedulerType, schedulerId),
        createSchedulerCreateTool(schedulerType, schedulerId),
        createSchedulerDeleteTool(schedulerType, schedulerId),
    ];
}
