import {
    ServiceContainer,
    T_ThreadId,
    IAgentCallback,
    ILoggerService,
} from "scorpio.ai";
import { config } from "./Config";
import { AgentFactory } from "./AgentFactory";
import { LoggerService } from "./LoggerService";

const logger = LoggerService.getLogger('AgentRunner.ts');

export class AgentRunner {
    static async run(
        userId: string,
        query: string,
        callbacks: IAgentCallback,
        userInfo?: any,
    ): Promise<void> {
        const agentName = config.settings.agent;
        if (!agentName) throw new Error("未配置 agent，请在 settings.json 中设置 agent 字段");
        const agentEntry = config.settings.agents?.[agentName];
        if (!agentEntry) throw new Error(`Agent 配置 "${agentName}" 不存在，请检查 settings.json 中的 agents 配置`);

        const container = new ServiceContainer();
        container.registerInstance(T_ThreadId, userId);
        container.registerInstance(ILoggerService, { getLogger: (name: string) => LoggerService.getLogger(name) });

        logger.info(`${userId} 使用 Agent [${agentName}] (${agentEntry.type})`);

        const agent = await AgentFactory.create(agentName, container, userInfo);
        try {
            await agent.stream(query, callbacks);
        } finally {
            await agent.dispose();
        }
    }
}
