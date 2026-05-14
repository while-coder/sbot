import path from "path"
import fs from "fs/promises"
import { Command, Arg, Option, Parsers, CommandContext, ICommand, ConversationCompactor, GlobalLoggerService } from "scorpio.ai"
import { SessionService } from "channel.base"
import { type ChannelConfig } from "sbot.commons"
import { type ChannelSessionRow } from "../Core/Database"
import { AgentRunner } from "../Agent/AgentRunner"
import { config, AgentMode, type ToolAgentEntry } from "../Core/Config"

type SbotService = SessionService & {
    resolveSessionConfig(args: any): Promise<{ dbSession: ChannelSessionRow; channelConfig?: ChannelConfig } | undefined>;
}

@Command('log', '查看系统日志')
export class LogCommand implements ICommand {
    _context!: CommandContext;

    @Arg('lines', {
        description: '显示的日志行数',
        required: false,
        parser: Parsers.int,
        default: '50'
    })
    lines!: number;

    @Option(['-l', '--level <level>'], {
        description: '过滤日志级别 (debug/info/warn/error)',
        parser: Parsers.enum(['debug', 'info', 'warn', 'error'] as const),
    })
    level?: string;

    @Option(['-d', '--date <date>'], {
        description: '指定日期 (yyyy-MM-dd)',
    })
    date?: string;

    async execute(): Promise<string> {
        const logsDir = config.getConfigPath("logs");
        const dateStr = this.date ?? new Date().toISOString().slice(0, 10);
        const logFile = path.join(logsDir, `log.${dateStr}.log`);

        try {
            const content = await fs.readFile(logFile, 'utf-8');
            let lines = content.split('\n').filter(Boolean);

            if (this.level) {
                const levelUpper = this.level.toUpperCase();
                lines = lines.filter(line => line.includes(`[${levelUpper}]`));
            }

            const total = lines.length;
            lines = lines.slice(-this.lines);

            if (lines.length === 0) return '没有找到匹配的日志记录';

            const header = `[${dateStr}] 共 ${total} 条日志，显示最近 ${lines.length} 条：\n`;
            return header + lines.join('\n');
        } catch (e: any) {
            if (e.code === 'ENOENT') return `日志文件不存在: log.${dateStr}.log`;
            return `读取日志失败: ${e.message}`;
        }
    }
}

/**
 * /clear 命令 - 清理当前会话的 saver 历史记录
 */
@Command('clear', '清理当前会话的历史记录')
export class ClearCommand implements ICommand {
    _context!: CommandContext;

    async execute(): Promise<string> {
        const session = this._context.context as SbotService;
        const resolved = await session.resolveSessionConfig(this._context.args);
        const saverId = resolved?.dbSession.saver || resolved?.channelConfig?.saver;
        if (!saverId) return '无法识别当前会话上下文，或当前会话未配置 saver';

        const saver = await AgentRunner.createSaverService(saverId, session.threadId);
        try {
            await saver.clearMessages();
            session.settings = {};
            session.saveSettings();
            return '历史记录已清理';
        } finally {
            await saver.dispose();
        }
    }
}

/**
 * /compact 命令 - 手动压缩对话历史
 */
@Command('compact', '压缩当前会话的对话历史')
export class CompactCommand implements ICommand {
    _context!: CommandContext;

    async execute(): Promise<string> {
        const session = this._context.context as SbotService;
        const resolved = await session.resolveSessionConfig(this._context.args);
        const saverId = resolved?.dbSession.saver || resolved?.channelConfig?.saver;
        if (!saverId) return '无法识别当前会话，或未配置 saver';

        const agentId = resolved?.dbSession.agentId || resolved?.channelConfig?.agent;
        if (!agentId) return '无法识别当前 Agent 配置';

        const agentEntry = config.getAgent(agentId);
        if (!agentEntry) return `Agent "${agentId}" 配置不存在`;

        if (agentEntry.type !== AgentMode.Single && agentEntry.type !== AgentMode.ReAct) return '当前 Agent 类型不支持压缩';
        const toolEntry = agentEntry as ToolAgentEntry;
        const compactModelId = toolEntry.compactModel || toolEntry.model;
        const summaryModel = await config.getModelService(compactModelId);
        if (!summaryModel) return `模型 "${compactModelId}" 不可用`;

        const saver = await AgentRunner.createSaverService(saverId, session.threadId);
        try {
            const compactor = new ConversationCompactor(summaryModel, toolEntry.compactPrompt, GlobalLoggerService.getLoggerService());
            const allMessages = await saver.getAllMessages();
            if (allMessages.length <= 1) return '消息过少，无需压缩';

            const result = await compactor.compact(allMessages);
            const compactedIds = allMessages.filter(m => m.id != null).map(m => m.id!);
            await saver.applyCompaction(compactedIds, ConversationCompactor.buildPostCompactMessage(result.summary, false));
            return `压缩完成：${allMessages.length} 条消息已压缩`;
        } finally {
            await saver.dispose();
        }
    }
}

/**
 * 获取所有内置命令
 */
export function getBuiltInCommands(): ICommand[] {
    return [
        new LogCommand(),
        new ClearCommand(),
        new CompactCommand(),
    ];
}
