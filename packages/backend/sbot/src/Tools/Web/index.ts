import { type StructuredToolInterface } from '@langchain/core/tools'

export { createWebFetchTool } from './fetch'
export { createWebDownloadTool } from './download'

import { createWebFetchTool } from './fetch'
import { createWebDownloadTool } from './download'

export function createWebFetchTools(): StructuredToolInterface[] {
    return [createWebFetchTool(), createWebDownloadTool()]
}
