import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { createTextContent, type MCPToolResult } from "../Core";

// -- Types -------------------------------------------------------------------

/** 子任务状态 */
export enum TaskStatus {
  Running = 'running',
  Done = 'done',
  Error = 'error',
}

/** 子任务注册表对外暴露的一条记录（已截断，适合回灌给编排 LLM 查看）。 */
export interface TaskInfo {
  taskId: string;
  agentId: string;
  name?: string;
  status: TaskStatus;
  firstTask: string;
  lastSummary?: string;
  turns: number;
}

export type GetTasksFn = () => TaskInfo[] | Promise<TaskInfo[]>;

// -- Factory -----------------------------------------------------------------

export const LIST_TASKS_TOOL_NAME = "_list_tasks";

const DEFAULT_DESC =
  "List the sub-agent tasks dispatched in this conversation, with each task's id, target agent, " +
  "status (running/done/error) and a short summary. Use it to recall what you delegated and to pick " +
  "a `taskId` to resume via `_dispatch_task`. Takes no arguments.";

export function createListTasksTool(getTasks: GetTasksFn, description: string = DEFAULT_DESC): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: LIST_TASKS_TOOL_NAME,
    description,
    schema: z.object({}) as any,
    func: async (): Promise<MCPToolResult> => {
      const tasks = await getTasks();
      if (tasks.length === 0) {
        return { content: [createTextContent("No sub-tasks have been dispatched yet.")] };
      }
      return { content: [createTextContent(JSON.stringify(tasks, null, 2))] };
    },
  });
}
