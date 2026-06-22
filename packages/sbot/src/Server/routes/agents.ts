import express from 'express';
import { config, isValidAgentId, AgentMode } from '../../Core/Config';
import { api, throwBad } from '../utils';
import { resolveAgentMcp, resolveAgentSkills } from './agentCapabilities';
import type { RouteContext } from './types';

/** 从 ChatMessage.content 提取纯文本（string 或 text part 拼接）。 */
function extractText(content: any): string {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) return content.map((p: any) => (p?.type === 'text' ? p.text ?? '' : '')).join('');
    return '';
}

export class AgentRoutes {
    register(app: express.Application, _ctx: RouteContext): void {
        // List all agents
        app.get('/api/agents', api(() => config.listAgents()));

        // Create agent
        app.post('/api/agents', api(req => {
            const body = req.body;
            const id = (body.id || '').trim();
            if (!id) throwBad('id is required');
            if (!isValidAgentId(id)) throwBad(`Invalid id "${id}"`);
            if (config.agentExists(id)) throwBad(`Agent "${id}" already exists`);
            config.saveAgent(id, body);
            return config.getAgent(id);
        }));

        // Get single agent
        app.get('/api/agents/:id', api(req => {
            return config.getAgent(req.params.id as string);
        }));

        // Update agent
        app.put('/api/agents/:id', api(req => {
            const id = req.params.id as string;
            config.saveAgent(id, req.body);
            return config.getAgent(id);
        }));

        // Delete agent
        app.delete('/api/agents/:id', api(req => {
            const id = req.params.id as string;
            config.deleteAgent(id);
            return { success: true };
        }));

        // 由 LLM 根据 agent 的 systemPrompt + tools + skills 生成一段"能力描述"（供编排者路由参考）
        app.post('/api/agents/:id/generate-desc', api(async req => {
            const id = req.params.id as string;
            const agent = config.getAgent(id) as any;

            const mcp = resolveAgentMcp(id);
            const skills = resolveAgentSkills(id);
            const subAgents = agent.type === AgentMode.ReAct && Array.isArray(agent.agents)
                ? agent.agents.map((a: any) => `${a.name || a.id}: ${a.desc}`)
                : [];

            const sections: string[] = [];
            if (agent.systemPrompt?.trim()) sections.push(`# System prompt\n${agent.systemPrompt.trim()}`);
            if (mcp.length) sections.push(`# Tools (MCP)\n${mcp.map(m => `- ${m.name}: ${m.description}`).join('\n')}`);
            if (skills.length) sections.push(`# Skills\n${skills.map(s => `- ${s.name}: ${s.description}`).join('\n')}`);
            if (subAgents.length) sections.push(`# Sub-agents\n${subAgents.map((s: string) => `- ${s}`).join('\n')}`);

            const prompt = [
                `你在为一个多 agent 编排系统编写「子 agent 能力描述」。这段描述会展示给编排者（上级 LLM），作为「什么任务应该派给这个 agent」的路由依据。`,
                ``,
                `请通读下面这个名为「${agent.name || id}」的 agent 的配置，总结出它能胜任的**所有功能 / 任务类型**，输出一段简洁、信息密度高的能力描述：`,
                `- 覆盖它的全部能力面（来自系统提示、工具、技能）；`,
                `- 面向「该把什么任务交给它」来写，而不是复述它的内部指令；`,
                `- 直接输出描述正文，不要标题、不要客套、不要解释你在做什么。`,
                ``,
                sections.join('\n\n') || '(该 agent 暂无可用配置信息)',
            ].join('\n');

            // 优先用编排者（调用方 ReAct agent）指定的 model：同模型生成的描述更贴合编排者的路由判断；
            // 其次回退到 target agent 自己的 model，再次取首个已配置 model。
            const modelId = (req.body?.model as string) || agent.model || Object.keys(config.settings.models ?? {})[0];
            if (!modelId) throwBad('No model configured to generate description');
            const modelService = config.getModelService(modelId, true)!;
            const result = await modelService.invoke(prompt);
            return { desc: extractText(result.content).trim() };
        }));
    }
}

export const agentRoutes = new AgentRoutes();
