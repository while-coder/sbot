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

function mdText(value: unknown): string {
    return String(value).replace(/[\\`*_{}[\]()#+\-.!|>]/g, '\\$&');
}

function mdCode(value: unknown): string {
    const text = String(value);
    const runs = text.match(/`+/g) ?? [];
    const fence = '`'.repeat(Math.max(1, ...runs.map(run => run.length + 1)));
    const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
    return `${fence}${pad}${text}${pad}${fence}`;
}

function mdCodeBlock(content: string, language = 'text'): string {
    const runs = content.match(/`{3,}/g) ?? [];
    const fence = '`'.repeat(Math.max(3, ...runs.map(run => run.length + 1)));
    return `${fence}${language}\n${content}\n${fence}`;
}

function mdMaybeCode(value: string | null | undefined, emptyText: string): string {
    return value ? mdCode(value) : emptyText;
}

function mdTitle(title: string, summary?: string): string {
    return summary ? `**${title}**：${summary}` : `**${title}**`;
}

function mdItem(label: string, value: string): string {
    return `- ${label}：${value}`;
}

function mdNamedRef(id: string, name?: string): string {
    return `${mdCode(id)}${name ? `（${mdText(name)}）` : ''}`;
}

function mdEnabled(value: boolean): string {
    return value ? '启用' : '停用';
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
    return `\n\n> ⚠️ 此配置被 ${count} 个会话共享，改动对它们全部生效。`;
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

            if (lines.length === 0) return `${mdTitle('日志')}\n没有找到匹配的日志记录。`;

            return [
                mdTitle('日志', `${mdCode(dateStr)}，共 ${total} 条，显示最近 ${lines.length} 条`),
                '',
                mdCodeBlock(lines.join('\n'), 'log'),
            ].join('\n');
        } catch (e: any) {
            if (e.code === 'ENOENT') return mdTitle('日志文件不存在', mdCode(`log.${dateStr}.log`));
            return mdTitle('读取日志失败', mdText(e.message));
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
        if (dbSessionId == null) return mdTitle('无法识别当前会话上下文');

        let handle;
        try {
            handle = await SaverPool.getInstance().acquireByDBSessionId(dbSessionId);
        } catch (e: any) {
            return mdTitle('无法获取 saver', mdText(e?.message ?? e));
        }
        try {
            await handle.saver.clearMessages();
            session.settings = {};
            session.saveSettings();
            return mdTitle('历史记录已清理');
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
        if (dbSessionId == null) return mdTitle('无法识别当前会话上下文');

        const eff = await session.resolveSessionConfig(this._context.args);
        const agentId = eff?.resolved.agentId;
        if (!agentId) return mdTitle('无法识别当前 Agent 配置');

        const agentEntry = config.getAgent(agentId);
        if (!agentEntry) return mdTitle('Agent 配置不存在', mdCode(agentId));

        if (agentEntry.type !== AgentMode.Single && agentEntry.type !== AgentMode.ReAct) return mdTitle('当前 Agent 类型不支持压缩');
        const toolEntry = agentEntry as ToolAgentEntry;
        const compactModelId = toolEntry.compactModel || toolEntry.model;
        const summaryModel = config.getModelService(compactModelId);
        if (!summaryModel) return mdTitle('模型不可用', mdCode(compactModelId));

        let handle;
        try {
            handle = await SaverPool.getInstance().acquireByDBSessionId(dbSessionId);
        } catch (e: any) {
            return mdTitle('无法获取 saver', mdText(e?.message ?? e));
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
            if (allMessages.length <= 1) return `${mdTitle('无需压缩')}\n消息过少。`;

            const postMessage = await compactor.compact(allMessages, false);
            const compactedIds = allMessages.map(m => m.id);
            await handle.saver.applyCompaction(compactedIds, postMessage);
            return mdTitle('压缩完成', `已压缩 ${allMessages.length} 条消息`);
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
        if (!eff) return mdTitle('无法识别当前会话上下文');
        const { resolved, profile } = eff;

        const lines: string[] = [];

        // Agent
        let agentLine = resolved.agentId || '(未设置)';
        let modelLine = '';
        if (resolved.agentId) {
            try {
                const a = config.getAgent(resolved.agentId);
                agentLine = `${mdNamedRef(a.id, a.name)} ${mdCode(a.type)}`;
                const modelId = (a as ToolAgentEntry).model;
                if (modelId) {
                    const m = config.settings.models?.[modelId];
                    modelLine = m?.name || m?.model || modelId;
                }
            } catch {
                agentLine = `${mdCode(resolved.agentId)}（配置不存在）`;
            }
        }
        lines.push(mdTitle('当前会话'));
        lines.push(mdItem('Agent', agentLine));
        if (modelLine) lines.push(mdItem('模型', mdText(modelLine)));
        lines.push(mdItem('Saver', mdMaybeCode(resolved.saver, '(未设置)')));
        lines.push(mdItem('工作目录', mdMaybeCode(resolved.workPath, '(未设置)')));
        lines.push(mdItem('功能', `自动批准 ${resolved.autoApproveAllTools ? '开' : '关'}，Memory ${resolved.memory ? '开' : '关'}，Agenda ${resolved.agenda ? '开' : '关'}`));
        lines.push(mdItem('资源', `Notes ${resolved.notes.length} 个，Wikis ${resolved.wikis.length} 个`));
        lines.push(mdItem('Token', `累计 ${profile.totalTokens}，上轮 ${profile.lastTotalTokens}`));

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
        if (!eff) return mdTitle('无法识别当前会话上下文');
        const { resolved, profile } = eff;

        // 查看
        if (!this.path) {
            const cur = resolved.workPath || '(未设置，使用渠道默认或进程目录)';
            return mdTitle('当前工作目录', resolved.workPath ? mdCode(cur) : cur);
        }

        // 重置
        if (this.path === 'reset' || this.path === 'clear') {
            await channelDataService.updateProfile(profile.id, { workPath: null });
            return `${mdTitle('工作目录已清空')}\n已回退渠道默认。${await shareHint(profile.id)}`;
        }

        // 设置：要求绝对路径且为已存在目录
        if (!path.isAbsolute(this.path)) {
            return mdTitle('路径必须是绝对路径', mdCode(this.path));
        }
        try {
            const stat = await fs.stat(this.path);
            if (!stat.isDirectory()) return mdTitle('路径不是目录', mdCode(this.path));
        } catch {
            return mdTitle('目录不存在', mdCode(this.path));
        }
        await channelDataService.updateProfile(profile.id, { workPath: this.path });
        return `${mdTitle('工作目录已设置', mdCode(this.path))}${await shareHint(profile.id)}`;
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
        if (!eff) return mdTitle('无法识别当前会话上下文');
        const { resolved, profile } = eff;

        // 列出
        if (this.id === 'list') {
            const agents = config.listAgents();
            if (agents.length === 0) return mdTitle('没有可用的 Agent');
            return `${mdTitle('可用 Agent')}\n` + agents
                .map(a => {
                    const tags = a.tags?.length ? ` ${a.tags.map(tag => mdCode(`#${tag}`)).join(' ')}` : '';
                    return `- ${mdNamedRef(a.id, a.name)} · ${mdCode(a.type)}${tags}`;
                })
                .join('\n');
        }

        // 查看
        if (!this.id) {
            const cur = resolved.agentId || '(未设置)';
            return [
                mdTitle('当前 Agent', resolved.agentId ? mdCode(cur) : cur),
                '',
                `使用 ${mdCode('/agent list')} 查看全部，${mdCode('/agent <id>')} 切换。`,
            ].join('\n');
        }

        // 重置
        if (this.id === 'reset') {
            await channelDataService.updateProfile(profile.id, { agentId: null });
            return `${mdTitle('Agent 设置已清空')}\n已回退渠道默认。${await shareHint(profile.id)}`;
        }

        // 切换
        if (!config.agentExists(this.id)) {
            return `${mdTitle('Agent 不存在', mdCode(this.id))}\n使用 ${mdCode('/agent list')} 查看可用项。`;
        }
        await channelDataService.updateProfile(profile.id, { agentId: this.id });
        return `${mdTitle('Agent 已切换', mdCode(this.id))}${await shareHint(profile.id)}`;
    }
}

/**
 * /saver 命令 - 查看 / 列出 / 切换 Saver
 */
@Command('saver', '查看、列出或切换当前会话的 Saver')
export class SaverCommand implements ICommand {
    _context!: CommandContext;

    @Arg('id', {
        description: 'Saver ID；传 list 列出全部；传 reset 回退渠道默认；不传则查看当前',
        required: false,
    })
    id?: string;

    async execute(): Promise<string> {
        const eff = await resolveEff(this._context);
        if (!eff) return mdTitle('无法识别当前会话上下文');
        const { resolved, profile } = eff;

        // 列出
        if (this.id === 'list') {
            const savers = Object.entries(config.settings.savers ?? {})
                .sort(([a], [b]) => a.localeCompare(b));
            if (savers.length === 0) return mdTitle('没有可用的 Saver');
            return `${mdTitle('可用 Saver')}\n` + savers
                .map(([id, saver]) => `- ${mdNamedRef(id, saver.name)} · ${mdCode(saver.type)}`)
                .join('\n');
        }

        // 查看
        if (!this.id) {
            const cur = resolved.saver || '(未设置)';
            return [
                mdTitle('当前 Saver', resolved.saver ? mdCode(cur) : cur),
                '',
                `使用 ${mdCode('/saver list')} 查看全部，${mdCode('/saver <id>')} 切换。`,
            ].join('\n');
        }

        // 重置
        if (this.id === 'reset') {
            await channelDataService.updateProfile(profile.id, { saver: null });
            return `${mdTitle('Saver 设置已清空')}\n已回退渠道默认。${await shareHint(profile.id)}`;
        }

        // 切换
        if (!config.getSaver(this.id)) {
            return `${mdTitle('Saver 不存在', mdCode(this.id))}\n使用 ${mdCode('/saver list')} 查看可用项。`;
        }
        await channelDataService.updateProfile(profile.id, { saver: this.id });
        return `${mdTitle('Saver 已切换', mdCode(this.id))}${await shareHint(profile.id)}`;
    }
}

/**
 * /memory 命令 - 查看 / 列出 / 切换 Memory Profile
 */
@Command('memory', '查看、列出或切换当前会话的 Memory Profile')
export class MemoryCommand implements ICommand {
    _context!: CommandContext;

    @Arg('id', {
        description: 'Memory Profile ID；传 list 列出全部；传 reset 回退渠道默认；不传则查看当前',
        required: false,
    })
    id?: string;

    async execute(): Promise<string> {
        const eff = await resolveEff(this._context);
        if (!eff) return mdTitle('无法识别当前会话上下文');
        const { resolved, profile } = eff;

        // 列出
        if (this.id === 'list') {
            const profiles = Object.entries(config.settings.memoryProfiles ?? {})
                .sort(([a], [b]) => a.localeCompare(b));
            if (profiles.length === 0) return mdTitle('没有可用的 Memory Profile');
            return `${mdTitle('可用 Memory Profile')}\n` + profiles
                .map(([id, p]) => `- ${mdNamedRef(id, p.name)} · ${mdEnabled(p.enabled)} · writer ${mdCode(p.writerModel)}`)
                .join('\n');
        }

        // 查看
        if (!this.id) {
            const cur = resolved.memory || '(未设置)';
            const p = resolved.memory ? config.getMemoryProfile(resolved.memory) : undefined;
            const current = resolved.memory
                ? `${mdNamedRef(resolved.memory, p?.name)}${p ? ` · ${mdEnabled(p.enabled)}` : '（配置不存在）'}`
                : cur;
            return [
                mdTitle('当前 Memory Profile', current),
                '',
                `使用 ${mdCode('/memory list')} 查看全部，${mdCode('/memory <id>')} 切换。`,
            ].join('\n');
        }

        // 重置
        if (this.id === 'reset') {
            await channelDataService.updateProfile(profile.id, { memory: null });
            return `${mdTitle('Memory Profile 设置已清空')}\n已回退渠道默认。${await shareHint(profile.id)}`;
        }

        // 切换
        if (!config.getMemoryProfile(this.id)) {
            return `${mdTitle('Memory Profile 不存在', mdCode(this.id))}\n使用 ${mdCode('/memory list')} 查看可用项。`;
        }
        await channelDataService.updateProfile(profile.id, { memory: this.id });
        return `${mdTitle('Memory Profile 已切换', mdCode(this.id))}${await shareHint(profile.id)}`;
    }
}

/**
 * /agenda 命令 - 查看 / 列出 / 切换 Agenda Profile
 */
@Command('agenda', '查看、列出或切换当前会话的 Agenda Profile')
export class AgendaCommand implements ICommand {
    _context!: CommandContext;

    @Arg('id', {
        description: 'Agenda Profile ID；传 list 列出全部；传 reset 回退渠道默认；不传则查看当前',
        required: false,
    })
    id?: string;

    async execute(): Promise<string> {
        const eff = await resolveEff(this._context);
        if (!eff) return mdTitle('无法识别当前会话上下文');
        const { resolved, profile } = eff;

        // 列出
        if (this.id === 'list') {
            const profiles = Object.entries(config.settings.agendaProfiles ?? {})
                .sort(([a], [b]) => a.localeCompare(b));
            if (profiles.length === 0) return mdTitle('没有可用的 Agenda Profile');
            return `${mdTitle('可用 Agenda Profile')}\n` + profiles
                .map(([id, p]) => {
                    const sync = p.syncModel ? `sync ${mdCode(p.syncModel)}` : 'sync 未配置';
                    return `- ${mdNamedRef(id, p.name)} · ${mdEnabled(p.enabled)} · ${sync}`;
                })
                .join('\n');
        }

        // 查看
        if (!this.id) {
            const cur = resolved.agenda || '(未设置)';
            const p = resolved.agenda ? config.getAgendaProfile(resolved.agenda) : undefined;
            const current = resolved.agenda
                ? `${mdNamedRef(resolved.agenda, p?.name)}${p ? ` · ${mdEnabled(p.enabled)}` : '（配置不存在）'}`
                : cur;
            return [
                mdTitle('当前 Agenda Profile', current),
                '',
                `使用 ${mdCode('/agenda list')} 查看全部，${mdCode('/agenda <id>')} 切换。`,
            ].join('\n');
        }

        // 重置
        if (this.id === 'reset') {
            await channelDataService.updateProfile(profile.id, { agenda: null });
            return `${mdTitle('Agenda Profile 设置已清空')}\n已回退渠道默认。${await shareHint(profile.id)}`;
        }

        // 切换
        if (!config.getAgendaProfile(this.id)) {
            return `${mdTitle('Agenda Profile 不存在', mdCode(this.id))}\n使用 ${mdCode('/agenda list')} 查看可用项。`;
        }
        await channelDataService.updateProfile(profile.id, { agenda: this.id });
        return `${mdTitle('Agenda Profile 已切换', mdCode(this.id))}${await shareHint(profile.id)}`;
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
        if (!eff) return mdTitle('无法识别当前会话上下文');
        const { resolved, profile } = eff;

        const toggle = parseToggle(this.value);

        // 查看
        if (toggle === undefined) {
            if (this.value != null) return `${mdTitle('无法识别的开关值', mdCode(this.value))}\n可用值：${mdCode('on')} / ${mdCode('off')}`;
            return mdTitle('自动批准全部工具', resolved.autoApproveAllTools ? '开' : '关');
        }

        await channelDataService.updateProfile(profile.id, { autoApproveAllTools: toggle });
        const note = toggle ? '\n\n> ⚠️ 已开启：所有工具调用将无需确认，请谨慎。' : '';
        return `${mdTitle('自动批准全部工具', toggle ? '开' : '关')}${note}${await shareHint(profile.id)}`;
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
        if (!eff) return mdTitle('无法识别当前会话上下文');
        const { profile } = eff;
        return [
            mdTitle('Token 使用量'),
            mdItem('累计', `输入 ${profile.inputTokens} / 输出 ${profile.outputTokens} / 合计 ${profile.totalTokens}`),
            mdItem('上轮', `输入 ${profile.lastInputTokens} / 输出 ${profile.lastOutputTokens} / 合计 ${profile.lastTotalTokens}`),
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
        return mdTitle(mdText(name), mdCode(`v${version}`));
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
            return mdItem('用户', mdText(summarizeContent(m.content) || '(空)'));
        case MessageRole.AI: {
            if (m.tool_calls?.length) {
                return mdItem('AI', `调用工具 ${m.tool_calls.map(t => mdCode(t.name)).join('、')}`);
            }
            return mdItem('AI', mdText(summarizeContent(m.content) || '(空)'));
        }
        case MessageRole.Tool:
            return mdItem('工具', `${mdCode(m.name ?? '工具')}${m.status ? `（${mdText(m.status)}）` : ''}：${mdText(summarizeContent(m.content) || '(空)')}`);
        case MessageRole.System:
            return mdItem('System', mdText(summarizeContent(m.content) || '(空)'));
        default:
            return mdItem(mdText(String(m.role)), mdText(summarizeContent(m.content) || '(空)'));
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
        if (dbSessionId == null) return mdTitle('无法识别当前会话上下文');

        let handle;
        try {
            handle = await SaverPool.getInstance().acquireByDBSessionId(dbSessionId);
        } catch (e: any) {
            return mdTitle('无法获取 saver', mdText(e?.message ?? e));
        }
        try {
            const all = await handle.saver.getAllMessages();
            if (all.length === 0) return mdTitle('暂无历史记录');

            const n = this.count > 0 ? this.count : 10;
            const slice = all.slice(-n);
            return [
                mdTitle('对话历史', `共 ${all.length} 条，显示最近 ${slice.length} 条`),
                '',
                ...slice.map(formatHistoryLine),
            ].join('\n');
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
        new SaverCommand(),
        new MemoryCommand(),
        new AgendaCommand(),
        new AutoApproveCommand(),
        new TokensCommand(),
        new VersionCommand(),
        new HistoryCommand(),
    ];
}
