import {
    ServiceContainer,
    IAgentCallback,
    ILoggerService,
} from "scorpio.ai";
import { config } from "./Config";
import { AgentFactory } from "./AgentFactory";
import { LoggerService } from "./LoggerService";

const logger = LoggerService.getLogger('AgentRunner.ts');

export class AgentRunner {
    static async run(
        query: string,
        callbacks: IAgentCallback,
        userInfo?: any,
        agentName?: string,
    ): Promise<void> {
        const resolvedAgentName = agentName || config.settings.agent;
        if (!resolvedAgentName) throw new Error("未配置 agent，请在 settings.json 中设置 agent 字段");
        const agentEntry = config.settings.agents?.[resolvedAgentName];
        if (!agentEntry) throw new Error(`Agent 配置 "${resolvedAgentName}" 不存在，请检查 settings.json 中的 agents 配置`);

        const extraPrompts: string[] = [];
        if (userInfo) {
            extraPrompts.push(`用户user_id:${userInfo.user_id}
用户open_id:${userInfo.open_id}
用户union_id:${userInfo.union_id}
用户姓名:${userInfo.name}
用户邮箱:${userInfo.email}`);
        }

        const container = new ServiceContainer();
        container.registerInstance(ILoggerService, { getLogger: (name: string) => LoggerService.getLogger(name) });

        logger.info(`使用 Agent [${resolvedAgentName}] (${agentEntry.type})`);

        const agent = await AgentFactory.create(resolvedAgentName, container, extraPrompts);
        try {
            await agent.stream(query, callbacks);
        } finally {
            await agent.dispose();
        }
    }
}
