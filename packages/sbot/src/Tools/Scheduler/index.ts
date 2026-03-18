import { type StructuredToolInterface } from '@langchain/core/tools';

export { createSchedulerListTool } from './list';
export { createSchedulerCreateTool } from './create';
export { createSchedulerDeleteTool } from './delete';

import { createSchedulerListTool } from './list';
import { createSchedulerCreateTool } from './create';
import { createSchedulerDeleteTool } from './delete';

export function createSchedulerTools(): StructuredToolInterface[] {
    return [
        createSchedulerListTool(),
        createSchedulerCreateTool(),
        createSchedulerDeleteTool(),
    ];
}
