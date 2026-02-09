import { Annotation, MessagesAnnotation } from '@langchain/langgraph';

/**
 * ReAct 步骤类型
 */
export enum ReActStepType {
  THOUGHT = "thought",      // 思考阶段
  ACTION = "action",        // 行动阶段
  OBSERVATION = "observation", // 观察阶段
  REFLECTION = "reflection" // 反思阶段
}

/**
 * ReAct 步骤
 */
export interface ReActStep {
  id: string;                   // 步骤唯一标识
  type: ReActStepType;          // 步骤类型
  content: string;              // 步骤内容
  agentType?: string;           // 如果是 ACTION，使用哪个 Agent
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

  // Agent 配置列表（从 Supervisor 继承）
  agentConfigs: Annotation<any[]>({
    reducer: (prev, next) => next ?? prev,
    default: () => [],
  }),
});
