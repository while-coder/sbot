import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import type { MCPToolResult } from "./types";

// ── Types ───────────────────────────────────────────────────────────────────

/** 上下文继承档位（仅新建会话生效，续接时忽略）：
 *  - None（默认）：子 agent 干净起步，task 须自包含；
 *  - State：注入主对话近期上下文快照，子 agent 可感知背景。 */
export enum TaskContextMode {
  None = 'none',
  State = 'state',
}

export interface TaskToolParams {
  agentId: string;
  task: string;
  systemPrompt?: string;
  context?: TaskContextMode;
  taskId?: string;
}

export type RunTaskFn = (params: TaskToolParams) => Promise<MCPToolResult>;

// ── Factory ─────────────────────────────────────────────────────────────────

export const TASK_TOOL_NAME = "_task";

export function createTaskTool(agentIds: string[], runFn: RunTaskFn, description: string): DynamicStructuredTool {
  const schema = z.object({
    // WHO：派给哪个子 agent（zod v4 的 z.enum 直接接受 string[]，无需 as/解构）
    agentId: z.enum(agentIds)
      .describe("ID of the specialized sub-agent to dispatch to."),
    // WHAT：本轮指令
    task: z.string()
      .describe("The instruction for the sub-agent this turn. Self-contained on a fresh session (see `context`); a short follow-up that builds on prior turns when resuming via `taskId`."),
    // BACKGROUND：手动情境上下文 + 自动上下文继承档位
    systemPrompt: z.string().optional()
      .describe("Optional situational context applied as a system-level instruction for this call (e.g. target file, constraints). Distinct from `task` (the per-turn instruction); not persisted across resumes — repeat it if still relevant."),
    context: z.enum(TaskContextMode).optional()
      .describe("Fresh-session context inheritance (ignored when resuming). 'none' (default): clean start, `task` must be self-contained. 'state': inject a snapshot of the recent main conversation — use when the task depends on what just happened."),
    // SESSION：续接已有会话
    taskId: z.string().optional()
      .describe("Resume a prior session by passing the `task_id: <uuid>` from an earlier result; omit to start fresh."),
  });

  return new DynamicStructuredTool({
    name: TASK_TOOL_NAME,
    description: description,
    schema: schema as any,
    func: async (params: any): Promise<MCPToolResult> => runFn(params),
  });
}
