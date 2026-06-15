import path from "path"
import fs from "fs/promises"
import { Command, Arg, Option, Parsers, CommandContext, ICommand, ConversationCompactor, GlobalLoggerService } from "scorpio.ai"
import { SessionService } from "channel.base"
import { type EffectiveSession } from "./ChannelDataService"
import { SaverPool } from "../Agent/SaverPool"
import { config, AgentMode, type ToolAgentEntry } from "../Core/Config"
import { loadPrompt } from "../Core/PromptLoader"

type SbotService = SessionService & {
    resolveSessionConfig(args: any): Promise<EffectiveSession | undefined>;
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
        const dbSessionId = this._context.args?.dbSessionId;
        if (dbSessionId == null) return '无法识别当前会话上下文';

        let handle;
        try {
            handle = await SaverPool.getInstance().acquireByDBSessionId(dbSessionId);
        } catch (e: any) {
            return `无法获取 saver: ${e?.message ?? e}`;
        }
        try {
            await handle.saver.clearMessages();
            session.settings = {};
            session.saveSettings();
            return '历史记录已清理';
        } finally {
            await handle.release();
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
        const dbSessionId = this._context.args?.dbSessionId;
        if (dbSessionId == null) return '无法识别当前会话上下文';

        const eff = await session.resolveSessionConfig(this._context.args);
        const agentId = eff?.resolved.agentId;
        if (!agentId) return '无法识别当前 Agent 配置';

        const agentEntry = config.getAgent(agentId);
        if (!agentEntry) return `Agent "${agentId}" 配置不存在`;

        if (agentEntry.type !== AgentMode.Single && agentEntry.type !== AgentMode.ReAct) return '当前 Agent 类型不支持压缩';
        const toolEntry = agentEntry as ToolAgentEntry;
        const compactModelId = toolEntry.compactModel || toolEntry.model;
        const summaryModel = config.getModelService(compactModelId);
        if (!summaryModel) return `模型 "${compactModelId}" 不可用`;

        let handle;
        try {
            handle = await SaverPool.getInstance().acquireByDBSessionId(dbSessionId);
        } catch (e: any) {
            return `无法获取 saver: ${e?.message ?? e}`;
        }
        try {
            const compactor = new ConversationCompactor(
                summaryModel,
                loadPrompt('compact/instruction.txt'),
                loadPrompt('compact/post_message.txt'),
                loadPrompt('compact/post_continuation.txt'),
                GlobalLoggerService.getLoggerService(),
            );
            const allMessages = await handle.saver.getAllMessages();
            if (allMessages.length <= 1) return '消息过少，无需压缩';

            const postMessage = await compactor.compact(allMessages, false);
            const compactedIds = allMessages.map(m => m.id);
            await handle.saver.applyCompaction(compactedIds, postMessage);
            return `压缩完成：${allMessages.length} 条消息已压缩`;
        } finally {
            await handle.release();
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
