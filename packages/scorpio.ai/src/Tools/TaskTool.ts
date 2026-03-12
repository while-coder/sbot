import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { createSuccessResult, createTextContent, MCPToolResult } from "./types";

// ── Types ───────────────────────────────────────────────────────────────────

export interface TaskToolParams {
  agentName: string;
  task: string;
}

export type RunTaskFn = (params: TaskToolParams) => Promise<string>;

// ── Factory ─────────────────────────────────────────────────────────────────

export function createTaskTool(agentNames: string[], runFn: RunTaskFn): DynamicStructuredTool {
  const schema = z.object({
    agentName: z.enum(agentNames as [string, ...string[]])
      .describe("Name of the sub-agent to invoke"),
    task: z.string()
      .describe("Complete, self-contained task instruction with all necessary context and constraints"),
  });

  return new DynamicStructuredTool({
    name: "task",
    description: "Dispatch a task to a specialized sub-agent and return its result.",
    schema: schema as any,
    func: async (params: any): Promise<MCPToolResult> => {
      const result = await runFn(params as TaskToolParams);
      return createSuccessResult(createTextContent(result));
    },
  });
}
