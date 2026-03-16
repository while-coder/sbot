import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { createSuccessResult, createTextContent, MCPToolResult } from "./types";

// ── Types ───────────────────────────────────────────────────────────────────

export interface TaskToolParams {
  agentId: string;
  goal: string;
  task: string;
  systemPrompt?: string;
}

export type RunTaskFn = (params: TaskToolParams) => Promise<string>;

// ── Factory ─────────────────────────────────────────────────────────────────

export function createTaskTool(agentIds: string[], runFn: RunTaskFn): DynamicStructuredTool {
  const schema = z.object({
    agentId: z.enum(agentIds as [string, ...string[]])
      .describe("ID of the sub-agent to invoke"),
    goal: z.string()
      .describe("The primary objective of this task in one concise sentence. Summarizes the end result expected from the sub-agent."),
    task: z.string()
      .describe("Complete, self-contained task instruction with all steps the agent must perform. Include every detail needed — the agent has no memory of prior conversation."),
    systemPrompt: z.string().optional()
      .describe("Background context injected as a system-level instruction before the task. Use this to describe the current situation, constraints, or any facts the agent must know to execute correctly (e.g. 'We are refactoring a TypeScript monorepo. The target file is src/foo.ts. Do not modify unrelated files.')."),
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
