import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import type { MCPToolResult } from "./types";

// ── Types ───────────────────────────────────────────────────────────────────

export interface TaskToolParams {
  agentId: string;
  task: string;
  systemPrompt?: string;
  taskId?: string;
}

export type RunTaskFn = (params: TaskToolParams) => Promise<MCPToolResult>;

// ── Factory ─────────────────────────────────────────────────────────────────

export const TASK_TOOL_NAME = "_task";

export function createTaskTool(agentIds: string[], runFn: RunTaskFn, description: string): DynamicStructuredTool {
  const schema = z.object({
    agentId: z.enum(agentIds as [string, ...string[]])
      .describe("ID of the specialized sub-agent to dispatch the task to."),
    task: z.string()
      .describe("Instruction for the sub-agent. Without `taskId` (fresh session), this must be self-contained — include every detail the agent needs, since it has no prior context. With `taskId` (resumed session), this is a follow-up that builds on the agent's existing history, so it can be a short next-step instruction."),
    systemPrompt: z.string().optional()
      .describe("Stable background context applied as a system-level instruction for this call (e.g. 'We are refactoring a TypeScript monorepo. The target file is src/foo.ts. Do not modify unrelated files.'). Distinct from `task`: `task` is the per-turn instruction; `systemPrompt` is situational context. Not persisted across resumes — pass it again on each call if still relevant."),
    taskId: z.string().optional()
      .describe("Resume a previous sub-agent session by passing the uuid from a prior call's result (look for the `task_id: <uuid>` line in the returned content). Omit to start a fresh session. Reusing the same taskId restores the sub-agent's full conversation history, including any auto-compacted summaries."),
  });

  return new DynamicStructuredTool({
    name: TASK_TOOL_NAME,
    description: description,
    schema: schema as any,
    func: async (params: any): Promise<MCPToolResult> => runFn(params),
  });
}
