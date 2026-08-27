import { type AgentTool } from "scorpio.ai";

export { createWebFetchTool } from './fetch'
export { createWebDownloadTool } from './download'

import { createWebFetchTool } from './fetch'
import { createWebDownloadTool } from './download'

export function createWebFetchTools(): AgentTool[] {
    return [createWebFetchTool(), createWebDownloadTool()]
}
