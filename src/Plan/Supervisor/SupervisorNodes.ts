import { AIMessage, HumanMessage } from "langchain";
import { END } from '@langchain/langgraph';
import { SupervisorAnnotation, TaskStatus, SubTask, ExecutionPlan, AgentConfig } from './SupervisorAnnotation.js';
import { IModelService } from "scorpio.ai";
import { LoggerService } from "../../LoggerService.js";
import { v4 as uuidv4 } from 'uuid';

const logger = LoggerService.getLogger("SupervisorNodes.ts");

/**
 * 格式化计划用于展示
 */
export function formatPlan(plan: ExecutionPlan): string {
  let output = `**目标**: ${plan.goal}\n\n**子任务**:\n`;
  plan.tasks.forEach((task, index) => {
    output += `${index + 1}. [${task.agentId}] ${task.description}\n`;
    if (task.dependencies.length > 0) {
      output += `   依赖: ${task.dependencies.join(', ')}\n`;
    }
  });
  return output;
}

/**
 * PLAN 节点：生成执行计划
 */
export async function planNode(
  state: typeof SupervisorAnnotation.State,
  modelService: IModelService
) {
  // 查找最后一条人类消息
  const lastHumanMessage = state.messages
    .slice()
    .reverse()
    .find(m => m._getType() === 'human');

  if (!lastHumanMessage) {
    logger.warn("PLAN 节点：未找到用户消息");
    return { plan: null };
  }

  const userQuery = lastHumanMessage.content as string;

  // 构建可用 Agent 描述
  const agentsDesc = state.agentConfigs
    .map(a => `- ${a.id}: ${a.desc || a.systemPrompt || '通用任务'}`)
    .join('\n');

  // 可用 Agent ID 列表
  const agentIds = state.agentConfigs.map(a => a.id);

  // 构建 JSON 示例中的任务（使用实际的 Agent ID）
  const exampleTasks = agentIds.slice(0, 2).map((id, i) => 
    `    {\n      "id": "task-${i + 1}",\n      "description": "任务详细描述",\n      "agentId": "${id}",\n      "dependencies": [${i > 0 ? '"task-1"' : ''}]\n    }`
  ).join(',\n');

  // 构建规划提示词
  const planningPrompt = `你是一个任务规划专家。请分析用户的请求，将其分解为多个可执行的子任务。

可用的 Agent：
${agentsDesc}

用户请求：
${userQuery}

请生成一个结构化的执行计划，包括：
1. 子任务列表（每个任务有清晰的描述和负责的 Agent 类型）
2. 任务之间的依赖关系（dependencies 为任务 ID 数组，如果没有依赖则为空数组）
3. 预期的执行顺序

以 JSON 格式返回，格式如下：
{
  "goal": "总体目标描述",
  "tasks": [
${exampleTasks}
  ]
}

注意：
- agentId 必须是以下 Agent 之一: ${agentIds.join(', ')}
- dependencies 中的任务 ID 必须是已存在的任务
- 任务 ID 使用 "task-1", "task-2" 这样的格式
- 每个 Agent 都有工具可以自主执行任务，任务描述应说明最终目标而非操作步骤`;

  try {
    logger.info("PLAN 节点：开始生成执行计划");

    // 构建完整的 prompt
    const fullPrompt = `系统提示：你是一个任务规划助手，只返回有效的 JSON 格式的计划，不要包含其他文本。

${planningPrompt}`;

    // 调用模型生成计划
    const response = await modelService.invoke(fullPrompt);

    // 解析计划
    const content = response.content as string;

    // 提取 JSON（处理可能的 markdown 代码块）
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.replace(/```json\s*/, '').replace(/```\s*$/, '');
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```\s*/, '').replace(/```\s*$/, '');
    }

    const planData = JSON.parse(jsonStr);

    const plan: ExecutionPlan = {
      id: uuidv4(),
      goal: planData.goal,
      tasks: planData.tasks.map((t: any) => ({
        id: t.id,
        description: t.description,
        agentId: t.agentId || t.agentType,
        dependencies: t.dependencies || [],
        status: TaskStatus.PENDING,
        assignedAgent: undefined,
        result: undefined,
        error: undefined
      })),
      approved: false,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    logger.info(`PLAN 节点：成功生成计划，包含 ${plan.tasks.length} 个子任务`);

    return {
      plan,
      messages: [
        new AIMessage(
          `我已为您制定了执行计划：\n\n${formatPlan(plan)}\n\n` +
          `请审批此计划（输入 /approve 批准，/reject 拒绝）`
        )
      ]
    };
  } catch (error: any) {
    logger.error(`PLAN 节点：生成计划失败 - ${error.message}`, error.stack);
    return {
      plan: null,
      messages: [
        new AIMessage(`抱歉，生成执行计划时出错：${error.message}`)
      ]
    };
  }
}

/**
 * SUPERVISOR 节点：任务调度和路由
 * @returns 路由目标节点名称
 */
export function supervisorNode(
  state: typeof SupervisorAnnotation.State
): string {
  const plan = state.plan;

  if (!plan) {
    logger.warn("SUPERVISOR 节点：计划不存在");
    return END;
  }

  if (!plan.approved) {
    logger.info("SUPERVISOR 节点：计划未审批，结束执行");
    return END;
  }

  // 查找下一个可执行的任务（状态为 PENDING 且依赖已满足）
  const nextTask = plan.tasks.find(task => {
    if (task.status !== TaskStatus.PENDING) return false;

    // 检查所有依赖是否已完成
    return task.dependencies.every(depId => {
      const depTask = plan.tasks.find(t => t.id === depId);
      return depTask?.status === TaskStatus.COMPLETED;
    });
  });

  if (!nextTask) {
    // 检查是否所有任务都已完成
    const allCompleted = plan.tasks.every(t => t.status === TaskStatus.COMPLETED);
    if (allCompleted) {
      logger.info("SUPERVISOR 节点：所有任务已完成，进入聚合节点");
      return "aggregator";
    } else {
      // 有任务失败或被阻塞
      const failedTasks = plan.tasks.filter(t => t.status === TaskStatus.FAILED || t.status === TaskStatus.BLOCKED);
      logger.warn(`SUPERVISOR 节点：有 ${failedTasks.length} 个任务失败或被阻塞，结束执行`);
      return END;
    }
  }

  // 更新任务状态为执行中
  nextTask.status = TaskStatus.IN_PROGRESS;
  logger.info(`SUPERVISOR 节点：调度任务 ${nextTask.id} 到 Agent ${nextTask.agentId}`);

  // 返回目标 Agent 节点名称
  return `agent_${nextTask.agentId}`;
}

/**
 * AGGREGATOR 节点：聚合所有任务结果
 */
export async function aggregatorNode(
  state: typeof SupervisorAnnotation.State,
  modelService: IModelService
) {
  const plan = state.plan;
  if (!plan) {
    logger.warn("AGGREGATOR 节点：计划不存在");
    return {};
  }

  // 收集所有任务结果
  const taskResults = plan.tasks
    .map(task => {
      const statusEmoji = task.status === TaskStatus.COMPLETED ? '✅' : '❌';
      return `${statusEmoji} [${task.id}] ${task.description}\n   结果: ${task.result || task.error || '无'}`;
    })
    .join('\n\n');

  // 构建聚合提示词
  const aggregationPrompt = `你是一个结果整合专家。以下是多个 Agent 完成的子任务结果：

${taskResults}

总体目标：${plan.goal}

请整合所有结果，生成一个完整、连贯的最终回复给用户。`;

  try {
    logger.info("AGGREGATOR 节点：开始聚合结果");

    // 构建完整的 prompt
    const fullPrompt = `系统提示：你是一个结果整合助手。

${aggregationPrompt}`;

    const response = await modelService.invoke(fullPrompt);

    logger.info("AGGREGATOR 节点：聚合完成");

    return {
      messages: [response]
    };
  } catch (error: any) {
    logger.error(`AGGREGATOR 节点：聚合失败 - ${error.message}`);
    return {
      messages: [
        new AIMessage(`任务执行完成，但结果聚合时出错：${error.message}\n\n任务结果：\n${taskResults}`)
      ]
    };
  }
}
