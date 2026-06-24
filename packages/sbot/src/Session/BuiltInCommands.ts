import path from "path"
import fs from "fs/promises"
import { Command, Arg, Option, Parsers, CommandContext, ICommand, ConversationCompactor, GlobalLoggerService, MessageRole, type StoredMessage, type MessageContent } from "scorpio.ai"
import { SessionService } from "channel.base"
import { channelDataService, type EffectiveSession } from "./ChannelDataService"
import { database } from "../Core/Database"
import { SaverPool } from "../Agent/SaverPool"
import { config, AgentMode, type ToolAgentEntry } from "../Core/Config"
import { loadPrompt } from "../Core/PromptLoader"

type SbotService = SessionService & {
    resolveSessionConfig(args: any): Promise<EffectiveSession | undefined>;
}

/** 解析当前会话的有效配置；拿不到上下文时返回 null */
async function resolveEff(ctx: CommandContext): Promise<EffectiveSession | null> {
    const session = ctx.context as SbotService;
    if (ctx.args?.dbSessionId == null) return null;
    return (await session.resolveSessionConfig(ctx.args)) ?? null;
}

/** profile 被多个会话共享时的提示文案（仅当 >1 时返回，否则空串） */
async function shareHint(profileId: number): Promise<string> {
    const count = await database.count(database.channelSession, { where: { profileId } });
    if (count <= 1) return '';
    return `\n⚠️ 此配置被 ${count} 个会话共享，改动对它们全部生效。`;
}

/** 把布尔开关参数解析成 true/false/undefined（undefined = 仅查询） */
function parseToggle(value: string | undefined): boolean | undefined {
    if (value == null) return undefined;
    const lower = value.toLowerCase();
    if (['on', 'true', '1', 'yes', 'open', '开'].includes(lower)) return true;
    if (['off', 'false', '0', 'no', 'close', '关'].includes(lower)) return false;
    return undefined;
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
 * /status 命令 - 查看当前会话的有效配置概览（只读）
 */
@Command('status', '查看当前会话的有效配置概览')
export class StatusCommand implements ICommand {
    _context!: CommandContext;

    async execute(): Promise<string> {
        const eff = await resolveEff(this._context);
        if (!eff) return '无法识别当前会话上下文';
        const { resolved, profile } = eff;

        const lines: string[] = [];

        // Agent
        let agentLine = resolved.agentId || '(未设置)';
        let modelLine = '';
        if (resolved.agentId) {
            try {
                const a = config.getAgent(resolved.agentId);
                agentLine = `${a.id}${a.name ? ` (${a.name})` : ''} [${a.type}]`;
                const modelId = (a as ToolAgentEntry).model;
                if (modelId) {
                    const m = config.settings.models?.[modelId];
                    modelLine = m?.name || m?.model || modelId;
                }
            } catch {
                agentLine = `${resolved.agentId} (配置不存在)`;
            }
        }
        lines.push(`Agent：${agentLine}`);
        if (modelLine) lines.push(`模型：${modelLine}`);
        lines.push(`工作目录：${resolved.workPath || '(未设置)'}`);
        lines.push(`Saver：${resolved.saver || '(未设置)'}`);
        lines.push(`自动批准全部工具：${resolved.autoApproveAllTools ? '开' : '关'}`);
        lines.push(`Memory：${resolved.memory ? '开' : '关'}　Agenda：${resolved.agenda ? '开' : '关'}`);
        lines.push(`Notes：${resolved.notes.length} 个　Wikis：${resolved.wikis.length} 个`);
        lines.push(`Token：累计 ${profile.totalTokens}（上轮 ${profile.lastTotalTokens}）`);

        return lines.join('\n');
    }
}

/**
 * /workpath 命令 - 查看 / 设置 / 重置工作目录
 */
@Command('workpath', '查看或设置当前会话的工作目录')
export class WorkpathCommand implements ICommand {
    _context!: CommandContext;

    @Arg('path', {
        description: '工作目录绝对路径；传 reset/clear 清空回退渠道默认；不传则查看当前值',
        required: false,
    })
    path?: string;

    async execute(): Promise<string> {
        const eff = await resolveEff(this._context);
        if (!eff) return '无法识别当前会话上下文';
        const { resolved, profile } = eff;

        // 查看
        if (!this.path) {
            const cur = resolved.workPath || '(未设置，使用渠道默认或进程目录)';
            return `当前工作目录：${cur}`;
        }

        // 重置
        if (this.path === 'reset' || this.path === 'clear') {
            await channelDataService.updateProfile(profile.id, { workPath: null });
            return `已清空工作目录设置，回退渠道默认。${await shareHint(profile.id)}`;
        }

        // 设置：要求绝对路径且为已存在目录
        if (!path.isAbsolute(this.path)) {
            return `路径必须是绝对路径：${this.path}`;
        }
        try {
            const stat = await fs.stat(this.path);
            if (!stat.isDirectory()) return `路径不是目录：${this.path}`;
        } catch {
            return `目录不存在：${this.path}`;
        }
        await channelDataService.updateProfile(profile.id, { workPath: this.path });
        return `工作目录已设置为：${this.path}${await shareHint(profile.id)}`;
    }
}

/**
 * /agent 命令 - 查看 / 列出 / 切换 Agent
 */
@Command('agent', '查看、列出或切换当前会话的 Agent')
export class AgentCommand implements ICommand {
    _context!: CommandContext;

    @Arg('id', {
        description: 'Agent ID；传 list 列出全部；传 reset 回退渠道默认；不传则查看当前',
        required: false,
    })
    id?: string;

    async execute(): Promise<string> {
        const eff = await resolveEff(this._context);
        if (!eff) return '无法识别当前会话上下文';
        const { resolved, profile } = eff;

        // 列出
        if (this.id === 'list') {
            const agents = config.listAgents();
            if (agents.length === 0) return '没有可用的 Agent';
            return '可用 Agent：\n' + agents
                .map(a => `- ${a.id}${a.name ? ` (${a.name})` : ''} [${a.type}]${a.tags?.length ? ` #${a.tags.join(' #')}` : ''}`)
                .join('\n');
        }

        // 查看
        if (!this.id) {
            const cur = resolved.agentId || '(未设置)';
            return `当前 Agent：${cur}\n（/agent list 查看全部，/agent <id> 切换）`;
        }

        // 重置
        if (this.id === 'reset') {
            await channelDataService.updateProfile(profile.id, { agentId: null });
            return `已清空 Agent 设置，回退渠道默认。${await shareHint(profile.id)}`;
        }

        // 切换
        if (!config.agentExists(this.id)) {
            return `Agent "${this.id}" 不存在，用 /agent list 查看可用项`;
        }
        await channelDataService.updateProfile(profile.id, { agentId: this.id });
        return `已切换 Agent 为：${this.id}${await shareHint(profile.id)}`;
    }
}

/**
 * /autoapprove 命令 - 查看 / 开关全量工具自动批准
 */
@Command('autoapprove', '查看或开关「自动批准全部工具」')
export class AutoApproveCommand implements ICommand {
    _context!: CommandContext;

    @Arg('value', {
        description: 'on 开启 / off 关闭；不传则查看当前',
        required: false,
    })
    value?: string;

    async execute(): Promise<string> {
        const eff = await resolveEff(this._context);
        if (!eff) return '无法识别当前会话上下文';
        const { resolved, profile } = eff;

        const toggle = parseToggle(this.value);

        // 查看
        if (toggle === undefined) {
            if (this.value != null) return `无法识别的开关值：${this.value}（用 on / off）`;
            return `自动批准全部工具：${resolved.autoApproveAllTools ? '开' : '关'}`;
        }

        await channelDataService.updateProfile(profile.id, { autoApproveAllTools: toggle });
        const note = toggle ? '\n⚠️ 已开启：所有工具调用将无需确认，请谨慎。' : '';
        return `自动批准全部工具：${toggle ? '开' : '关'}${note}${await shareHint(profile.id)}`;
    }
}

/**
 * /tokens 命令 - 查看 token 使用量（只读）
 */
@Command('tokens', '查看当前会话的 token 使用量')
export class TokensCommand implements ICommand {
    _context!: CommandContext;

    async execute(): Promise<string> {
        const eff = await resolveEff(this._context);
        if (!eff) return '无法识别当前会话上下文';
        const { profile } = eff;
        return [
            `累计：输入 ${profile.inputTokens} / 输出 ${profile.outputTokens} / 合计 ${profile.totalTokens}`,
            `上轮：输入 ${profile.lastInputTokens} / 输出 ${profile.lastOutputTokens} / 合计 ${profile.lastTotalTokens}`,
        ].join('\n');
    }
}

/**
 * /version 命令 - 查看 sbot 版本（只读）
 */
@Command('version', '查看 sbot 版本')
export class VersionCommand implements ICommand {
    _context!: CommandContext;

    async execute(): Promise<string> {
        const { name, version } = config.pkg;
        return `${name} v${version}`;
    }
}

/** 把消息内容压缩成单行摘要（提取文本，图片/音频用占位符替代，截断） */
function summarizeContent(content: MessageContent, maxLen = 120): string {
    let text: string;
    if (typeof content === 'string') {
        text = content;
    } else {
        text = content.map(part => {
            if (part.type === 'text') return part.text ?? '';
            if (part.type === 'image' || part.type === 'image_url') return '[图片]';
            if (part.type === 'audio') return '[音频]';
            return '';
        }).join(' ');
    }
    text = text.replace(/\s+/g, ' ').trim();
    return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
}

/** 单条历史消息格式化成一行 */
function formatHistoryLine(stored: StoredMessage): string {
    const m = stored.message;
    switch (m.role) {
        case MessageRole.Human:
            return `👤 ${summarizeContent(m.content) || '(空)'}`;
        case MessageRole.AI: {
            if (m.tool_calls?.length) {
                return `🤖 [调用工具] ${m.tool_calls.map(t => t.name).join(', ')}`;
            }
            return `🤖 ${summarizeContent(m.content) || '(空)'}`;
        }
        case MessageRole.Tool:
            return `🔧 ${m.name ?? '工具'}${m.status ? `(${m.status})` : ''}: ${summarizeContent(m.content)}`;
        case MessageRole.System:
            return `⚙️ ${summarizeContent(m.content)}`;
        default:
            return `${m.role}: ${summarizeContent(m.content)}`;
    }
}

/**
 * /history 命令 - 查看最近的对话历史（只读）
 */
@Command('history', '查看最近的对话历史')
export class HistoryCommand implements ICommand {
    _context!: CommandContext;

    @Arg('count', {
        description: '显示的消息条数',
        required: false,
        parser: Parsers.int,
        default: '10',
    })
    count!: number;

    async execute(): Promise<string> {
        const dbSessionId = this._context.args?.dbSessionId;
        if (dbSessionId == null) return '无法识别当前会话上下文';

        let handle;
        try {
            handle = await SaverPool.getInstance().acquireByDBSessionId(dbSessionId);
        } catch (e: any) {
            return `无法获取 saver: ${e?.message ?? e}`;
        }
        try {
            const all = await handle.saver.getAllMessages();
            if (all.length === 0) return '暂无历史记录';

            const n = this.count > 0 ? this.count : 10;
            const slice = all.slice(-n);
            const header = `共 ${all.length} 条消息，显示最近 ${slice.length} 条：\n`;
            return header + slice.map(formatHistoryLine).join('\n');
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
        new StatusCommand(),
        new WorkpathCommand(),
        new AgentCommand(),
        new AutoApproveCommand(),
        new TokensCommand(),
        new VersionCommand(),
        new HistoryCommand(),
    ];
}
