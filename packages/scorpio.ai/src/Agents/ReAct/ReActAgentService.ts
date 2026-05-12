import { type StructuredToolInterface } from "@langchain/core/tools";
import { inject, ServiceContainer, T_StaticSystemPrompts, T_DynamicSystemPrompts, T_ReactSystemPromptTemplate, T_ReactSubNodePrompt, T_ReactTaskToolDesc, T_MemorySystemPromptTemplate, T_WikiSystemPromptTemplate } from "../../Core";
import { IMemoryService, ReadOnlyMemoryService } from "../../Memory";
import { IWikiService } from "../../Wiki";
import { IAgentSaverService, ChatMessage, ChatMessageOptions, type MessageContent } from "../../Saver";
import { ILoggerService } from "../../Logger";
import { IModelService } from "../../Model";
import { type AgentServiceBase, IAgentCallback, AgentSubNode, CreateAgentFn, T_CreateAgent, MessageRole } from "../AgentServiceBase";
import { ISkillService } from "../../Skills";
import { IAgentToolService } from "../../AgentTool";
import { AgentMemorySaver } from "../../Saver/AgentMemorySaver";
import { SingleAgentService } from "../Single/SingleAgentService";
import { createTaskTool, type RunTaskFn } from "../../Tools";
import { MCPContentType, createTextContent, createImageContent, createAudioContent, createErrorResult, type MCPContent } from "../../Tools/types";
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
    @inject(T_StaticSystemPrompts, { optional: true }) systemPrompts?: string[],
    @inject(T_DynamicSystemPrompts, { optional: true }) dynamicSystemPrompts?: string[],
    @inject(IAgentSaverService, { optional: true }) agentSaver?: IAgentSaverService,
    @inject(ILoggerService, { optional: true }) loggerService?: ILoggerService,
    @inject(ISkillService, { optional: true }) skillService?: ISkillService,
    @inject(IAgentToolService, { optional: true }) toolService?: IAgentToolService,
    @inject(IMemoryService, { optional: true }) memoryServices?: IMemoryService[],
    @inject(IWikiService, { optional: true }) wikiServices?: IWikiService[],
    @inject(T_MemorySystemPromptTemplate, { optional: true }) memorySystemPromptTemplate?: string,
    @inject(T_WikiSystemPromptTemplate, { optional: true }) private wikiSystemPromptTemplateValue?: string,
  ) {
    super(thinkModelService, systemPrompts, dynamicSystemPrompts, loggerService, agentSaver, skillService, toolService, memoryServices, wikiServices, memorySystemPromptTemplate, wikiSystemPromptTemplateValue);
    this.agentSubNodes = agentSubNodes;
    this.agentFactory = agentFactory;
  }

  // ── Overrides ────────────────────────────────────────────────

  protected override async buildSystemMessage(query: MessageContent): Promise<ChatMessage | undefined> {
    const agentsDesc = this.agentSubNodes.map(a =>
      `  <agent id="${a.id}">${a.desc}</agent>`
    ).join('\n');
    const reactPrompt = this.systemPromptTemplate.replace('{agents}', agentsDesc);

    const parentMsg = await super.buildSystemMessage(query);
    if (!parentMsg) {
      return { role: MessageRole.System, content: [{ type: "text", text: reactPrompt }] };
    }

    const parentContent = parentMsg.content as Array<{ type: string; text: string }>;
    return {
      role: MessageRole.System,
      content: [
        { type: "text", text: reactPrompt + "\n\n" + parentContent[0].text },
        ...parentContent.slice(1),
      ],
    };
  }

  protected override async buildTools(callback?: IAgentCallback, signal?: AbortSignal): Promise<StructuredToolInterface[]> {
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
        if (this.wikiServices && this.wikiServices.length > 0) subContainer.registerInstance(IWikiService, this.wikiServices);
        if (this.memorySystemPromptTemplate) subContainer.registerInstance(T_MemorySystemPromptTemplate, this.memorySystemPromptTemplate);
        if (this.wikiSystemPromptTemplate) subContainer.registerInstance(T_WikiSystemPromptTemplate, this.wikiSystemPromptTemplate);
        if (this.loggerService) subContainer.registerInstance(ILoggerService, this.loggerService);

        agentService = await this.agentFactory(agentId, subContainer);

        const extraPrompts: string[] = [];
        if (goal?.trim()) extraPrompts.push(`<goal>${goal.trim()}</goal>`);
        if (systemPrompt?.trim()) extraPrompts.push(systemPrompt.trim());
        extraPrompts.push(this.subNodePrompt);
        agentService.addSystemPrompts(extraPrompts);

        const messages = await agentService.stream(task, subCallback, signal);
        const content: MCPContent[] = [];
        for (const msg of messages) {
          if (msg.role !== MessageRole.AI || !msg.content) continue;
          if (typeof msg.content === 'string') {
            if (msg.content.trim()) content.push(createTextContent(msg.content));
          } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (part.type === MCPContentType.Text && part.text?.trim()) {
                content.push(createTextContent(part.text));
              } else if (part.type === MCPContentType.Image && part.data) {
                content.push(createImageContent(part.data, part.mimeType));
              } else if (part.type === MCPContentType.Audio && part.data) {
                content.push(createAudioContent(part.data, part.mimeType));
              }
            }
          }
        }
        if (content.length === 0) content.push(createTextContent(''));
        return { content, thinkId };
      } catch (error: any) {
        return { ...createErrorResult(`Execution failed: ${error.message}`), thinkId };
      } finally {
        await agentService?.dispose();
      }
    };

    const agentIds = this.agentSubNodes.map(a => a.id);
    const parentTools = await super.buildTools(callback, signal);
    return [createTaskTool(agentIds, runFn, this.taskToolDesc), ...parentTools];
  }

  override async dispose(): Promise<void> {
    await super.dispose();
    await this.modelService.dispose();
  }
}
