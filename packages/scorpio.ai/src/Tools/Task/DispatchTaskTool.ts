import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import type { MCPToolResult } from "../Core";
// 仅类型导入（编译期擦除），不构成 Tools ↔ Agents 的运行时循环依赖
import type { OnCreateThinkFn } from "../../Agents/AgentServiceBase";

// -- Types -------------------------------------------------------------------

/** 上下文继承档位（仅新建会话生效，续接时忽略）：
 *  - None（默认）：子 agent 干净起步，task 须自包含；
 *  - State：注入主对话近期上下文快照，子 agent 可感知背景。 */
export enum TaskContextMode {
  None = 'none',
  State = 'state',
}

export interface DispatchTaskToolParams {
  agentId: string;
  task: string;
  systemPrompt?: string;
  contextMode?: TaskContextMode;
  taskId?: string;
}

/** runFn 的实参：LLM 填的 schema 字段 + 运行期由框架注入的上下文（不对模型暴露）。 */
export type RunDispatchTaskArgs = DispatchTaskToolParams & {
  /** 框架预留的 think 记录 id：子 agent 的消息应实时写入该 id 下。缺省时实现方自行生成。 */
  thinkId?: string;
  /** 声明本次派发确实开启了 think 流，框架据此把 thinkId 关联到本次 tool_call 通知渠道。 */
  onCreateThink?: OnCreateThinkFn;
};

export type RunDispatchTaskFn = (params: RunDispatchTaskArgs) => Promise<MCPToolResult>;

// -- Factory -----------------------------------------------------------------

export const DISPATCH_TASK_TOOL_NAME = "_dispatch_task";

const DEFAULT_DESC =
  "Dispatch a task to a specialized sub-agent and return its result. Omit `taskId` to start a fresh " +
  "sub-agent session; pass the returned `task_id` back as `taskId` to resume the same session. Fresh " +
  "tasks must be self-contained unless `contextMode` is `state`; resumed tasks can be short follow-ups.";

export function createDispatchTaskTool(agentIds: string[], runFn: RunDispatchTaskFn, description: string = DEFAULT_DESC): DynamicStructuredTool {
  const schema = z.object({
    // WHO：派给哪个子 agent（zod v4 的 z.enum 直接接受 string[]，无需 as/解构）
    agentId: z.enum(agentIds)
      .describe("ID of the specialized sub-agent to dispatch to."),
    // WHAT：本轮指令
    task: z.string()
      .describe("The instruction for the sub-agent this turn. Self-contained on a fresh session (see `contextMode`); a short follow-up that builds on prior turns when resuming via `taskId`."),
    // BACKGROUND：手动情境上下文 + 自动上下文继承档位
    systemPrompt: z.string().optional()
      .describe("Optional situational context applied as a system-level instruction for this call (e.g. target file, constraints). Distinct from `task` (the per-turn instruction); not persisted across resumes — repeat it if still relevant."),
    contextMode: z.enum(TaskContextMode).optional()
      .describe("Fresh-session context inheritance (ignored when resuming). 'none' (default): clean start, `task` must be self-contained. 'state': inject a snapshot of the recent main conversation — use when the task depends on what just happened."),
    // SESSION：续接已有会话
    taskId: z.string().optional()
      .describe("Resume a prior session by passing the `task_id: <uuid>` from an earlier result; omit to start fresh."),
  });

  return new DynamicStructuredTool({
    name: DISPATCH_TASK_TOOL_NAME,
    description: description,
    schema: schema as any,
    // 第三参是 invoke 时传入的 RunnableConfig，SingleAgentService 在其 configurable 里
    // 预置 thinkId 与 onCreateThink（见 runSingleTool），这里透传给实现方。
    func: async (params: any, _runManager?: any, config?: any): Promise<MCPToolResult> =>
      runFn({
        ...params,
        thinkId: config?.configurable?.thinkId,
        onCreateThink: config?.configurable?.onCreateThink,
      }),
  });
}
