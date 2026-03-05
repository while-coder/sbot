import os from 'os';
import path from 'path';
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

        const now = new Date();
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const assetsDir = path.resolve(__dirname, '../assets');
        const httpUrl = config.getHttpUrl();
        const extraPrompts: string[] = [
            `当前时间：${now.toLocaleString('zh-CN', { timeZone: timezone, hour12: false })}
时区：${timezone}
操作系统：${os.type()} ${os.release()} (${os.platform()})
系统语言：${process.env.LANG || Intl.DateTimeFormat().resolvedOptions().locale || 'zh-CN'}
生成供用户查看或下载的文件时，将文件保存至 ${assetsDir}，并以 ${httpUrl}/assets/<文件名> 形式提供访问地址。`,
        ];
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
