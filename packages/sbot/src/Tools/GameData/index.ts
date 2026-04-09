import { type StructuredToolInterface } from '@langchain/core/tools';

export { createGameDataListTool } from './list.js';
export { createGameDataSchemaTool } from './schema.js';
export { createGameDataQueryTool } from './query.js';
export { createGameDataUpdateTool } from './update.js';

import { createGameDataListTool } from './list.js';
import { createGameDataSchemaTool } from './schema.js';
import { createGameDataQueryTool } from './query.js';
import { createGameDataUpdateTool } from './update.js';

export function createGameDataTools(): StructuredToolInterface[] {
    return [
        createGameDataListTool(),
        createGameDataSchemaTool(),
        createGameDataQueryTool(),
        createGameDataUpdateTool(),
    ];
}
