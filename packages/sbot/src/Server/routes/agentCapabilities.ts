import { config } from '../../Core/Config';
import { globalAgentToolService, BuiltinProvider } from '../../Agent/GlobalAgentToolService';
import { globalSkillService } from '../../Agent/GlobalSkillService';

/** 能力条目：名称 + 描述 */
export interface CapabilityItem {
    name: string;
    description: string;
}

/** 全部可见 mcp provider（内置 + 全局），带 id 用于按 agent.mcp 过滤 */
function listGlobalMcps(): { id: string; name: string; description: string }[] {
    return [
        ...Object.values(BuiltinProvider).map(n => ({
            id: n as string,
            name: n as string,
            description: globalAgentToolService.getProviderDescription(n) || '',
        })),
        ...Object.entries(config.getGlobalMcpServers()).map(([id, s]: [string, any]) => ({
            id,
            name: s.name || id,
            description: s.description || '',
        })),
    ];
}

/** 解析某 agent 实际可用的 mcp providers（内置/全局按 mcp 字段过滤 + 专属 servers）。 */
export function resolveAgentMcp(agentId: string): CapabilityItem[] {
    let agent: any;
    try { agent = config.getAgent(agentId); } catch { return []; }
    const mcp = agent?.mcp;
    const all = listGlobalMcps();
    const globals = mcp === '*'
        ? all
        : ((mcp as string[]) || [])
            .map(id => all.find(m => m.id === id))
            .filter((m): m is NonNullable<typeof m> => !!m);
    const servers = Object.entries(config.getAgentMcpServers(agentId)).map(([id, s]: [string, any]) => ({
        id, name: s.name || id, description: s.description || '',
    }));
    return [...globals, ...servers].map(({ name, description }) => ({ name, description }));
}

/** 解析某 agent 实际可用的 skills（按 skills 字段过滤）。 */
export function resolveAgentSkills(agentId: string): CapabilityItem[] {
    let agent: any;
    try { agent = config.getAgent(agentId); } catch { return []; }
    const skills = agent?.skills;
    const all = globalSkillService.getAllSkills();
    const matched = skills === '*'
        ? all
        : ((skills as string[]) || [])
            .map(n => all.find((s: any) => s.name === n))
            .filter((s): s is NonNullable<typeof s> => !!s);
    return matched.map((s: any) => ({ name: s.name, description: s.description || '' }));
}
