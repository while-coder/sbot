import { Annotation, MessagesAnnotation } from '@langchain/langgraph';

/**
 * ReAct 节点/步骤类型
 * 同时用作 LangGraph 节点名称和步骤历史中的类型标签
 */
export enum ReActNode {
  Think = "think",               // 思考/规划
  Action = "action",             // 执行行动（实际节点名为 agent_xxx）
  Observe = "observe",           // 观察行动结果
  Reflect = "reflect",           // 反思总结
  WaitForUser = "wait_for_user", // 等待用户确认
}

/**
 * 根据 Agent ID 生成节点名称
 */
export function agentNodeName(agentId: string): string {
  return `agent_${agentId}`;
}

/**
 * ReAct 步骤
 */
export interface ReActStep {
  id: string;                   // 步骤唯一标识
  type: ReActNode;              // 步骤类型
  content: string;              // 步骤内容
  agentType?: string;           // 如果是 Action，使用哪个 Agent
  result?: string;              // 执行结果
  timestamp: number;            // 时间戳
}

/**
 * ReAct 状态
 */
export interface ReActState {
  goal: string;                 // 总体目标
  currentStep: ReActStep | null; // 当前步骤
  steps: ReActStep[];           // 步骤历史
  isComplete: boolean;          // 是否完成
  waitingForUser: boolean;      // 是否等待用户确认
  maxIterations: number;        // 最大迭代次数
  currentIteration: number;     // 当前迭代次数
}

/**
 * ReAct 状态 Annotation
 * 用于 ReAct 模式的多 Agent 协同
 */
export const ReActAnnotation = Annotation.Root({
  // 继承消息状态
  ...MessagesAnnotation.spec,

  // ReAct 状态
  reactState: Annotation<ReActState | null>({
    reducer: (prev, next) => next ?? prev,
    default: () => null,
  }),

  // Agent 配置列表
  agentConfigs: Annotation<any[]>({
    reducer: (prev, next) => next ?? prev,
    default: () => [],
  }),
});
