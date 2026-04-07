import { type StructuredToolInterface } from "@langchain/core/tools";
import { inject, ServiceContainer, T_SystemPrompts, T_ReactSystemPromptTemplate, T_ReactSubNodePrompt, T_ReactTaskToolDesc, T_MemorySystemPromptTemplate } from "../../Core";
import { IMemoryService, ReadOnlyMemoryService } from "../../Memory";
import { IAgentSaverService, ChatMessage, ChatMessageOptions } from "../../Saver";
import { ILoggerService } from "../../Logger";
import { IModelService } from "../../Model";
import { type AgentServiceBase, IAgentCallback, ICancellationToken, AgentSubNode, CreateAgentFn, T_CreateAgent, MessageRole } from "../AgentServiceBase";
import { ISkillService } from "../../Skills";
import { IAgentToolService } from "../../AgentTool";
import { AgentMemorySaver } from "../../Saver/AgentMemorySaver";
import { SingleAgentService } from "../Single/SingleAgentService";
import { createTaskTool, type RunTaskFn } from "../../Tools";
import { v4 as uuidv4 } from "uuid";

// ── ThinkForwardSaver ────────────────────────────────────────

/**
 * 包装 AgentMemorySaver，每次 pushMessage 时同步转发到父 saver 的 think 记录
 */
class ThinkForwardSaver extends AgentMemorySaver {
  constructor(private thinkId: string, private parentSaver: IAgentSaverService) { super(); }

  override async pushMessage(message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
    await super.pushMessage(message, options);
    await this.parentSaver.pushThinkMessage(this.thinkId, message);
  }

  override async pushThinkMessage(thinkId: string, message: ChatMessage, options?: ChatMessageOptions): Promise<void> {
    await super.pushThinkMessage(thinkId, message, options);
    await this.parentSaver.pushThinkMessage(thinkId, message, options);
  }
}

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

  constructor(
    @inject(T_ThinkModelService) thinkModelService: IModelService,
    @inject(T_AgentSubNodes) agentSubNodes: AgentSubNode[],
    @inject(T_CreateAgent) agentFactory: CreateAgentFn,
    @inject(T_ReactSystemPromptTemplate) private systemPromptTemplate: string,
    @inject(T_ReactSubNodePrompt) private subNodePrompt: string,
    @inject(T_ReactTaskToolDesc) private taskToolDesc: string,
    @inject(T_SystemPrompts, { optional: true }) systemPrompts?: string[],
    @inject(IAgentSaverService, { optional: true }) agentSaver?: IAgentSaverService,
    @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
    @inject(ISkillService, { optional: true }) skillService?: ISkillService,
    @inject(IAgentToolService, { optional: true }) toolService?: IAgentToolService,
    @inject(IMemoryService, { optional: true }) memoryServices?: IMemoryService[],
    @inject(T_MemorySystemPromptTemplate, { optional: true }) memorySystemPromptTemplate?: string,
  ) {
    super(thinkModelService, systemPrompts, loggerService, agentSaver, skillService, toolService, memoryServices, memorySystemPromptTemplate);
    this.agentSubNodes = agentSubNodes;
    this.agentFactory = agentFactory;
  }

  // ── Overrides ────────────────────────────────────────────────

  protected override async buildSystemMessage(query: string, callback?: IAgentCallback, cancellationToken?: ICancellationToken): Promise<ChatMessage | null> {
    const agentsDesc = this.agentSubNodes.map(a =>
      `  <agent id="${a.id}">${a.desc}</agent>`
    ).join('\n');
    const parts: string[] = [this.systemPromptTemplate.replace('{agents}', agentsDesc)];

    // Append systemPrompts, memory, and skill prompts from parent
    const parentMsg = await super.buildSystemMessage(query, callback, cancellationToken);
    if (parentMsg) parts.push(parentMsg.content as string);

    return { role: MessageRole.System, content: parts.join('\n\n') };
  }

  protected override async buildTools(callback?: IAgentCallback, cancellationToken?: ICancellationToken): Promise<StructuredToolInterface[]> {
    if (!callback) return [];
    const { onMessage: _, ...subCallback } = callback;

    const runFn: RunTaskFn = async ({ agentId, goal, task, systemPrompt }) => {
      let agentService: AgentServiceBase | null = null;
      const thinkId = uuidv4();
      try {
        const parentSaver = this.saverService;
        const thinkSaver = new ThinkForwardSaver(thinkId, parentSaver);
        const subContainer = new ServiceContainer();
        subContainer.registerInstance(IAgentSaverService, thinkSaver);
        if (this.memoryServices.length > 0) subContainer.registerInstance(IMemoryService, this.memoryServices.map(m => new ReadOnlyMemoryService(m)));
        if (this.memorySystemPromptTemplate) subContainer.registerInstance(T_MemorySystemPromptTemplate, this.memorySystemPromptTemplate);
        if (this.loggerService) subContainer.registerInstance(ILoggerService, this.loggerService);

        agentService = await this.agentFactory(agentId, subContainer);

        const extraPrompts: string[] = [];
        if (goal?.trim()) extraPrompts.push(`<goal>${goal.trim()}</goal>`);
        if (systemPrompt?.trim()) extraPrompts.push(systemPrompt.trim());
        extraPrompts.push(this.subNodePrompt);
        agentService.addSystemPrompts(extraPrompts);

        const messages = await agentService.stream(task, subCallback, cancellationToken);
        const finalMsg = [...messages].reverse().find(
          m => m.role === MessageRole.AI && typeof m.content === 'string' && m.content
        );
        return { result: finalMsg ? (finalMsg.content as string) : '', thinkId: thinkId };
      } catch (error: any) {
        return { result: `Execution failed: ${error.message}`, thinkId: thinkId };
      } finally {
        await agentService?.dispose();
      }
    };

    const agentIds = this.agentSubNodes.map(a => a.id);
    const parentTools = await super.buildTools(callback, cancellationToken);
    return [createTaskTool(agentIds, runFn, this.taskToolDesc), ...parentTools];
  }

  override async dispose(): Promise<void> {
    await super.dispose();
    await this.modelService.dispose();
  }
}
