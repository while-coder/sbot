import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { createSuccessResult, createTextContent, MCPToolResult } from "./types";

// ── Types ───────────────────────────────────────────────────────────────────

export interface TaskToolParams {
  agentId: string;
  task: string;
}

export type RunTaskFn = (params: TaskToolParams) => Promise<string>;

// ── Factory ─────────────────────────────────────────────────────────────────

export function createTaskTool(agentIds: string[], runFn: RunTaskFn): DynamicStructuredTool {
  const schema = z.object({
    agentId: z.enum(agentIds as [string, ...string[]])
      .describe("ID of the sub-agent to invoke"),
    task: z.string()
      .describe("Complete, self-contained task instruction with all necessary context and constraints"),
  });

  return new DynamicStructuredTool({
    name: "task",
    description: "Dispatch a task to a specialized sub-agent and return its result.",
    schema: schema as any,
    func: async (params: any): Promise<MCPToolResult> => {
      const result = await runFn(params);
      return createSuccessResult(createTextContent(result));
    },
  });
}
