import { Annotation, MessagesAnnotation } from '@langchain/langgraph';

/**
 * 任务状态枚举
 */
export enum TaskStatus {
  PENDING = "pending",        // 待执行
  IN_PROGRESS = "in_progress", // 执行中
  COMPLETED = "completed",     // 已完成
  FAILED = "failed",          // 失败
  BLOCKED = "blocked"         // 被阻塞
}

/**
 * 子任务定义
 */
export interface SubTask {
  id: string;                 // 任务唯一标识
  description: string;        // 任务描述
  agentType: string;          // 负责的 Agent 类型（如 "coder", "researcher"）
  dependencies: string[];     // 依赖的任务 ID
  status: TaskStatus;         // 任务状态
  result?: string;            // 任务结果
  error?: string;             // 错误信息
  assignedAgent?: string;     // 分配的具体 Agent 实例 ID
}

/**
 * 执行计划
 */
export interface ExecutionPlan {
  id: string;                 // 计划唯一标识
  goal: string;               // 总体目标
  tasks: SubTask[];           // 子任务列表
  approved: boolean;          // 用户是否已审批
  createdAt: number;          // 创建时间戳
  updatedAt: number;          // 更新时间戳
}

/**
 * Agent 配置定义
 */
export interface AgentConfig {
  id: string;                 // Agent 实例 ID
  type: string;               // Agent 类型
  skillName?: string;         // 关联的 Skill 名称
  tools: string[];            // 可用工具列表
  systemPrompt?: string;      // 自定义系统提示词
}

/**
 * 任务历史事件
 */
export interface TaskHistoryEvent {
  taskId: string;
  timestamp: number;
  event: string;
}

/**
 * Supervisor 状态 Annotation
 * 扩展 MessagesAnnotation，增加任务和计划管理
 */
export const SupervisorAnnotation = Annotation.Root({
  // 继承消息状态
  ...MessagesAnnotation.spec,

  // 当前执行计划
  plan: Annotation<ExecutionPlan | null>({
    reducer: (prev, next) => next ?? prev,
    default: () => null,
  }),

  // 当前任务上下文
  currentTask: Annotation<SubTask | null>({
    reducer: (prev, next) => next ?? prev,
    default: () => null,
  }),

  // Agent 配置列表
  agentConfigs: Annotation<AgentConfig[]>({
    reducer: (prev, next) => next ?? prev,
    default: () => [],
  }),

  // 任务执行历史（用于跟踪）
  taskHistory: Annotation<TaskHistoryEvent[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
});
