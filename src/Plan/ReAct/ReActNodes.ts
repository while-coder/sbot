import { AIMessage, HumanMessage } from "langchain";
import { END } from '@langchain/langgraph';
import { ReActAnnotation, ReActStepType, ReActStep, ReActState, ReActNodeName, agentNodeName } from './ReActAnnotation.js';
import { IModelService } from "scorpio.ai";
import { LoggerService } from "../../LoggerService.js";
import { v4 as uuidv4 } from 'uuid';

const logger = LoggerService.getLogger("ReActNodes.ts");

/**
 * 格式化 ReAct 步骤历史
 */
function formatStepHistory(steps: ReActStep[]): string {
  if (steps.length === 0) return "暂无历史步骤";

  return steps.map((step, index) => {
    const prefix = `步骤 ${index + 1} [${step.type}]`;
    if (step.type === ReActStepType.THOUGHT) {
      return `${prefix} 思考: ${step.content}`;
    } else if (step.type === ReActStepType.ACTION) {
      return `${prefix} 行动: ${step.content} (使用 ${step.agentType} Agent)`;
    } else if (step.type === ReActStepType.OBSERVATION) {
      return `${prefix} 观察: ${step.content}`;
    } else if (step.type === ReActStepType.REFLECTION) {
      return `${prefix} 反思: ${step.content}`;
    }
    return `${prefix}: ${step.content}`;
  }).join('\n');
}

/**
 * THINK 节点：推理下一步行动
 */
export async function thinkNode(
  state: typeof ReActAnnotation.State,
  modelService: IModelService
) {
  const reactState = state.reactState;
  if (!reactState) {
    logger.error("THINK 节点：ReAct 状态为空");
    return {};
  }

  // 检查是否达到最大迭代次数
  if (reactState.currentIteration >= reactState.maxIterations) {
    logger.warn(`THINK 节点：已达到最大迭代次数 ${reactState.maxIterations}`);
    reactState.isComplete = true;
    return { reactState };
  }

  logger.info(`THINK 节点：开始推理 (迭代 ${reactState.currentIteration + 1}/${reactState.maxIterations})`);

  // 查找最后一条人类消息
  const lastHumanMessage = state.messages
    .slice()
    .reverse()
    .find(m => m._getType() === 'human');

  const userQuery = lastHumanMessage ? (lastHumanMessage.content as string) : reactState.goal;

  // 构建可用 Agent 类型描述
  const agentTypesDesc = state.agentConfigs
    .map((a: any) => `- ${a.type}: ${a.systemPrompt || a.skillName || '通用任务'}`)
    .join('\n');

  // 构建步骤历史
  const stepHistory = formatStepHistory(reactState.steps);

  // 构建思考提示词
  const thinkPrompt = `你是一个 ReAct (Reasoning and Acting) 规划专家。请分析当前情况并决定下一步行动。

**总体目标**: ${reactState.goal}

**用户原始请求**: ${userQuery}

**可用的 Agent 类型**:
${agentTypesDesc}

**已执行的步骤历史**:
${stepHistory}

**当前状态**:
- 迭代次数: ${reactState.currentIteration + 1}/${reactState.maxIterations}
- 目标是否完成: ${reactState.isComplete ? '是' : '否'}

请进行推理并以 JSON 格式返回你的决策：

{
  "thought": "你的推理过程和分析",
  "needsAction": true/false,
  "isComplete": true/false,
  "nextAction": {
    "description": "需要执行的具体行动描述",
    "agentType": "coder/researcher/general",
    "reason": "为什么选择这个 Agent"
  }
}

规则：
1. 如果目标已经完成，设置 isComplete = true, needsAction = false
2. 如果需要执行新的行动，设置 needsAction = true，并提供 nextAction
3. 如果遇到问题或信息不足，在 thought 中说明，并决定下一步行动
4. 每次只规划一个行动，不要一次性规划多个步骤
5. 基于历史步骤的结果进行决策`;

  try {
    const fullPrompt = `系统提示：你是一个 ReAct 规划助手，只返回有效的 JSON 格式，不要包含其他文本。

${thinkPrompt}`;

    const response = await modelService.invoke(fullPrompt);
    const content = response.content as string;

    // 提取 JSON
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.replace(/```json\s*/, '').replace(/```\s*$/, '');
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/```\s*/, '').replace(/```\s*$/, '');
    }

    const decision = JSON.parse(jsonStr);

    // 创建思考步骤
    const thinkStep: ReActStep = {
      id: uuidv4(),
      type: ReActStepType.THOUGHT,
      content: decision.thought,
      timestamp: Date.now()
    };

    reactState.steps.push(thinkStep);
    reactState.currentIteration += 1;

    // 更新完成状态
    if (decision.isComplete) {
      reactState.isComplete = true;
      logger.info("THINK 节点：任务已完成");
    }

    // 如果需要行动，创建行动步骤
    if (decision.needsAction && decision.nextAction) {
      const actionStep: ReActStep = {
        id: uuidv4(),
        type: ReActStepType.ACTION,
        content: decision.nextAction.description,
        agentType: decision.nextAction.agentType,
        timestamp: Date.now()
      };

      reactState.steps.push(actionStep);
      reactState.currentStep = actionStep;

      logger.info(`THINK 节点：规划行动 - ${decision.nextAction.description} (${decision.nextAction.agentType})`);
    } else {
      reactState.currentStep = null;
    }

    return {
      reactState,
      messages: [new AIMessage(`🤔 **思考**: ${decision.thought}`)]
    };
  } catch (error: any) {
    logger.error(`THINK 节点：推理失败 - ${error.message}`);
    reactState.isComplete = true;
    return {
      reactState,
      messages: [new AIMessage(`推理过程出错：${error.message}`)]
    };
  }
}

/**
 * ROUTER 节点：路由到下一个节点
 */
export function routerNode(state: typeof ReActAnnotation.State): string {
  const reactState = state.reactState;

  if (!reactState) {
    logger.error("ROUTER 节点：ReAct 状态为空");
    return END;
  }

  // 如果已完成，进入反思节点
  if (reactState.isComplete) {
    logger.info("ROUTER 节点：任务完成，进入反思节点");
    return ReActNodeName.Reflect;
  }

  // 如果有当前步骤（ACTION），路由到对应的 Agent
  if (reactState.currentStep && reactState.currentStep.type === ReActStepType.ACTION) {
    const agentType = reactState.currentStep.agentType;
    logger.info(`ROUTER 节点：路由到 Agent ${agentType}`);
    return agentNodeName(agentType!);
  }

  // 默认继续思考
  logger.info("ROUTER 节点：继续思考");
  return ReActNodeName.Think;
}

/**
 * OBSERVE 节点：观察行动结果
 */
export async function observeNode(
  state: typeof ReActAnnotation.State,
  actionResult: string
) {
  const reactState = state.reactState;
  if (!reactState) {
    logger.error("OBSERVE 节点：ReAct 状态为空");
    return {};
  }

  logger.info("OBSERVE 节点：记录观察结果");

  // 更新当前步骤的结果
  if (reactState.currentStep) {
    reactState.currentStep.result = actionResult;
  }

  // 创建观察步骤
  const observeStep: ReActStep = {
    id: uuidv4(),
    type: ReActStepType.OBSERVATION,
    content: actionResult,
    timestamp: Date.now()
  };

  reactState.steps.push(observeStep);
  reactState.currentStep = null;

  return {
    reactState,
    messages: [new AIMessage(`👀 **观察**: ${actionResult.substring(0, 200)}${actionResult.length > 200 ? '...' : ''}`)]
  };
}

/**
 * REFLECT 节点：最终反思和总结
 */
export async function reflectNode(
  state: typeof ReActAnnotation.State,
  modelService: IModelService
) {
  const reactState = state.reactState;
  if (!reactState) {
    logger.error("REFLECT 节点：ReAct 状态为空");
    return {};
  }

  logger.info("REFLECT 节点：开始最终反思");

  // 构建步骤历史
  const stepHistory = formatStepHistory(reactState.steps);

  // 构建反思提示词
  const reflectPrompt = `请基于以下执行过程，生成最终总结：

**目标**: ${reactState.goal}

**执行过程**:
${stepHistory}

请生成一个简洁的总结，包括：
1. 完成了哪些主要任务
2. 获得了什么结果
3. 是否完全达成目标`;

  try {
    const fullPrompt = `系统提示：你是一个结果总结助手。

${reflectPrompt}`;

    const response = await modelService.invoke(fullPrompt);
    const reflection = response.content as string;

    // 创建反思步骤
    const reflectStep: ReActStep = {
      id: uuidv4(),
      type: ReActStepType.REFLECTION,
      content: reflection,
      timestamp: Date.now()
    };

    reactState.steps.push(reflectStep);

    logger.info("REFLECT 节点：反思完成");

    return {
      reactState,
      messages: [new AIMessage(`✨ **总结**:\n\n${reflection}`)]
    };
  } catch (error: any) {
    logger.error(`REFLECT 节点：反思失败 - ${error.message}`);
    return {
      messages: [new AIMessage(`任务执行完成，但生成总结时出错：${error.message}`)]
    };
  }
}
