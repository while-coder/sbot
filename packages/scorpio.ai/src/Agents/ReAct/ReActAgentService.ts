import { SystemMessage, BaseMessage, AIMessage } from "langchain";
import { type StructuredToolInterface } from "@langchain/core/tools";
import { inject, ServiceContainer } from "../../Core";
import { IMemoryService, ReadOnlyMemoryService } from "../../Memory";
import { IAgentSaverService } from "../../Saver";
import { ILoggerService } from "../../Logger";
import { IModelService } from "../../Model";
import { IAgentCallback, AgentSubNode, CreateAgentFn, T_CreateAgent } from "../AgentServiceBase";
import { T_SystemPrompts } from "../../Core";
import { ISkillService } from "../../Skills";
import { IAgentToolService } from "../../AgentTool";
import { AgentMemorySaver } from "../../Saver/AgentMemorySaver";
import { SingleAgentService } from "../Single/SingleAgentService";
import { createTaskTool, type RunTaskFn } from "../../Tools";

// ── Tokens ────────────────────────────────────────────────────

export const T_AgentSubNodes = Symbol("scorpio:T_AgentSubNodes");
export const T_ThinkModelService = Symbol("scorpio:T_ThinkModelService");

// ── ReActAgentService ─────────────────────────────────────────

/**
 * ReAct 多 Agent 编排服务，继承 SingleAgentService。
 *
 * 将子 Agent 封装为工具，由 thinkModel 驱动标准的 agent → tools → agent 循环。
 * 重写 buildSystemMessage / buildTools，其余流程（saver、memory、StateGraph 循环）复用父类。
 */
export class ReActAgentService extends SingleAgentService {
  private agentSubNodes: AgentSubNode[];
  private agentFactory: CreateAgentFn;
  private _streamCallback: IAgentCallback | null = null;

  constructor(
    @inject(T_ThinkModelService) thinkModelService: IModelService,
    @inject(T_AgentSubNodes) agentSubNodes: AgentSubNode[],
    @inject(T_CreateAgent) agentFactory: CreateAgentFn,
    @inject(T_SystemPrompts, { optional: true }) systemPrompts?: string[],
    @inject(IMemoryService, { optional: true }) memoryService?: IMemoryService,
    @inject(IAgentSaverService, { optional: true }) agentSaver?: IAgentSaverService,
    @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
    @inject(ISkillService, { optional: true }) skillService?: ISkillService,
    @inject(IAgentToolService, { optional: true }) toolService?: IAgentToolService,
  ) {
    super(thinkModelService, systemPrompts ?? [], loggerService, agentSaver, skillService, memoryService, toolService);
    this.agentSubNodes = agentSubNodes;
    this.agentFactory = agentFactory;
  }

  // ── Overrides ────────────────────────────────────────────────

  protected override async buildSystemMessage(query: string): Promise<SystemMessage | null> {
    const agentsDesc = this.agentSubNodes.map(a =>
      `  <agent id="${a.id}" name="${a.name}">${a.desc}</agent>`
    ).join('\n');
    const parts: string[] = [`You are a ReAct orchestration expert. Break down the user's request and dispatch sub-tasks to specialized agents using the \`task\` tool.

<agents>
${agentsDesc}
</agents>

<rules>
  <rule>One call at a time: invoke one agent, wait for the result, then decide the next step.</rule>
  <rule>Self-contained instructions: each task field must include all context the agent needs — no references to prior history.</rule>
  <rule>No repeats: once an agent succeeds at a goal, never call it again for the same goal.</rule>
  <rule>Finish when done: reply to the user directly as soon as all goals are met; do not call any more tools.</rule>
  <rule>On failure: change strategy — switch agents, split the task, or adjust the approach.</rule>
</rules>`];

    // Append systemPrompts, memory, and skill prompts from parent
    const parentMsg = await super.buildSystemMessage(query);
    if (parentMsg) parts.push(parentMsg.content as string);

    return new SystemMessage(parts.join('\n\n'));
  }

  protected override async buildTools(): Promise<StructuredToolInterface[]> {
    const callback = this._streamCallback;
    if (!callback) return [];
    const { onMessage: _, ...subCallback } = callback;

    const runFn: RunTaskFn = async ({ agentId, task }) => {
      let agentService: SingleAgentService | null = null;
      try {
        const subContainer = new ServiceContainer();
        subContainer.registerSingleton(IAgentSaverService, AgentMemorySaver);
        if (this.memoryService) subContainer.registerInstance(IMemoryService, new ReadOnlyMemoryService(this.memoryService));
        if (this.loggerService) subContainer.registerInstance(ILoggerService, this.loggerService);

        agentService = await this.agentFactory(agentId, subContainer) as SingleAgentService;
        agentService.addSystemPrompts([`<rules>
  <rule>You have all the information needed. Invoke available tools immediately.</rule>
  <rule>Do not ask questions, request clarification, or output suggestions or plans.</rule>
  <rule>Make reasonable assumptions for any uncertainty and proceed.</rule>
  <rule>If the task truly cannot be completed, return the specific reason directly.</rule>
</rules>`]);

        const messages = await agentService.stream(task, subCallback);
        const finalMsg = [...messages].reverse().find(
          m => m instanceof AIMessage && typeof m.content === 'string' && m.content
        );
        return finalMsg ? (finalMsg.content as string) : '';
      } catch (error: any) {
        return `Execution failed: ${error.message}`;
      } finally {
        await agentService?.dispose();
      }
    };

    const agentIds = this.agentSubNodes.map(a => a.id);
    const parentTools = await super.buildTools();
    return [createTaskTool(agentIds, runFn), ...parentTools];
  }

  override async stream(query: string, callback: IAgentCallback): Promise<BaseMessage[]> {
    this.logger?.info(`ReAct 开始 | 用户: ${this.saverService.threadId} | Agents: [${this.agentSubNodes.map(r => r.id).join(', ')}] | 查询: ${query.substring(0, 80)}`);
    this._streamCallback = callback;
    try {
      return await super.stream(query, callback);
    } finally {
      this._streamCallback = null;
    }
  }

  override async dispose(): Promise<void> {
    await super.dispose();
    await this.modelService.dispose();
  }
}
