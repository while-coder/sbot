import path from "path"
import fs from "fs/promises"
import { Command, Arg, Option, Parsers, CommandContext, ICommand, ConversationCompactor, GlobalLoggerService, MessageRole, type StoredMessage, type MessageContent } from "scorpio.ai"
import { SessionService } from "channel.base"
import { channelDataService, type EffectiveSession } from "./ChannelDataService"
import { database, parseNotes } from "../Core/Database"
import { SaverPool } from "../Agent/SaverPool"
import { config, AgentMode, type ToolAgentEntry } from "../Core/Config"
import { loadPrompt } from "../Core/PromptLoader"

const BUILTIN_ARG_LIST = 'list';
const BUILTIN_ARG_RESET = 'reset';
const BUILTIN_ARG_CLEAR = 'clear';
const BUILTIN_ARG_ADD = 'add';
const BUILTIN_ARG_REMOVE = 'remove';

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

function mdConfiguredRef(id: string, name?: string): string {
    return name ? mdNamedRef(id, name) : `${mdCode(id)}（配置不存在）`;
}

function mdRefList(ids: string[], resolveName: (id: string) => string | undefined): string {
    return ids.length > 0
        ? ids.map(id => mdConfiguredRef(id, resolveName(id))).join('、')
        : '(无)';
}

function mdOptionalRef(id: string | null | undefined, name: string | undefined, exists: boolean, suffix = ''): string {
    if (!id) return '(未设置)';
    return exists ? `${mdNamedRef(id, name)}${suffix}` : `${mdCode(id)}（配置不存在）`;
}

function mdChannelDefaultUsage(profileValue: string | null | undefined, channelValue: string | null | undefined): string {
    if (profileValue != null) return '否（当前 Profile）';
    return channelValue ? '是' : '是（渠道未配置）';
}

function mdWithChannelDefaultUsage(value: string, profileValue: string | null | undefined, channelValue: string | null | undefined): string {
    return `${value} · 使用渠道默认：${mdChannelDefaultUsage(profileValue, channelValue)}`;
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
        const channel = config.getChannel(eff.session.channelId);

        const lines: string[] = [];

        let agentLine = '(未设置)';
        let modelLine = '';
        if (resolved.agentId) {
            try {
                const agent = config.getAgent(resolved.agentId);
                agentLine = `${mdNamedRef(agent.id, agent.name)} · ${mdCode(agent.type)}`;
                const modelId = (agent as ToolAgentEntry).model;
                if (modelId) {
                    const model = config.settings.models?.[modelId];
                    modelLine = mdNamedRef(modelId, model?.name || model?.model);
                }
            } catch {
                agentLine = `${mdCode(resolved.agentId)}（配置不存在）`;
            }
        }

        const saver = resolved.saver ? config.getSaver(resolved.saver) : undefined;
        const memory = resolved.memory ? config.getMemoryProfile(resolved.memory) : undefined;
        const agenda = resolved.agenda ? config.getAgendaProfile(resolved.agenda) : undefined;
        const noteName = (id: string) => config.getNote(id)?.name;
        const wikiName = (id: string) => config.getWiki(id)?.name;

        lines.push(mdTitle('当前会话'));
        lines.push(mdItem('Agent', mdWithChannelDefaultUsage(agentLine, profile.agentId, channel?.agent)));
        if (modelLine) lines.push(mdItem('模型', modelLine));
        lines.push(mdItem('Saver', mdWithChannelDefaultUsage(mdOptionalRef(resolved.saver, saver?.name, !!saver, saver ? ` · ${mdCode(saver.type)}` : ''), profile.saver, channel?.saver)));
        lines.push(mdItem('Memory Profile', mdWithChannelDefaultUsage(mdOptionalRef(resolved.memory, memory?.name, !!memory, memory ? ` · ${mdEnabled(memory.enabled)}` : ''), profile.memory, channel?.memory)));
        lines.push(mdItem('Agenda Profile', mdWithChannelDefaultUsage(mdOptionalRef(resolved.agenda, agenda?.name, !!agenda, agenda ? ` · ${mdEnabled(agenda.enabled)}` : ''), profile.agenda, channel?.agenda)));
        lines.push(mdItem('Notes', mdRefList(resolved.notes, noteName)));
        lines.push(mdItem('Wikis', mdRefList(resolved.wikis, wikiName)));
        lines.push(mdItem('工作目录', mdMaybeCode(resolved.workPath, '(未设置)')));
        lines.push(mdItem('自动批准全部工具', resolved.autoApproveAllTools ? '开' : '关'));
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
        description: `工作目录绝对路径；传 ${BUILTIN_ARG_RESET}/${BUILTIN_ARG_CLEAR} 清空回退渠道默认；不传则查看当前值`,
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
        if (this.path === BUILTIN_ARG_RESET || this.path === BUILTIN_ARG_CLEAR) {
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
        description: `Agent ID；传 ${BUILTIN_ARG_LIST} 列出全部；传 ${BUILTIN_ARG_RESET} 回退渠道默认；不传则查看当前`,
        required: false,
    })
    id?: string;

    async execute(): Promise<string> {
        const eff = await resolveEff(this._context);
        if (!eff) return mdTitle('无法识别当前会话上下文');
        const { resolved, profile } = eff;

        // 列出
        if (this.id === BUILTIN_ARG_LIST) {
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
            const channel = config.getChannel(eff.session.channelId);
            return [
                mdTitle('当前 Agent'),
                mdItem('生效值', resolved.agentId ? mdCode(cur) : cur),
                mdItem('使用渠道默认', mdChannelDefaultUsage(profile.agentId, channel?.agent)),
                '',
                `使用 ${mdCode(`/agent ${BUILTIN_ARG_LIST}`)} 查看全部，${mdCode('/agent <id>')} 切换。`,
            ].join('\n');
        }

        // 重置
        if (this.id === BUILTIN_ARG_RESET) {
            const channel = config.getChannel(eff.session.channelId);
            await channelDataService.updateProfile(profile.id, { agentId: null });
            return `${mdTitle('Agent 设置已清空')}\n${mdItem('使用渠道默认', mdChannelDefaultUsage(null, channel?.agent))}${await shareHint(profile.id)}`;
        }

        // 切换
        if (!config.agentExists(this.id)) {
            return `${mdTitle('Agent 不存在', mdCode(this.id))}\n使用 ${mdCode(`/agent ${BUILTIN_ARG_LIST}`)} 查看可用项。`;
        }
        await channelDataService.updateProfile(profile.id, { agentId: this.id });
        return `${mdTitle('Agent 已切换', mdCode(this.id))}\n${mdItem('使用渠道默认', '否（当前 Profile）')}${await shareHint(profile.id)}`;
    }
}

/**
 * /saver 命令 - 查看 / 列出 / 切换 Saver
 */
@Command('saver', '查看、列出或切换当前会话的 Saver')
export class SaverCommand implements ICommand {
    _context!: CommandContext;

    @Arg('id', {
        description: `Saver ID；传 ${BUILTIN_ARG_LIST} 列出全部；传 ${BUILTIN_ARG_RESET} 回退渠道默认；不传则查看当前`,
        required: false,
    })
    id?: string;

    async execute(): Promise<string> {
        const eff = await resolveEff(this._context);
        if (!eff) return mdTitle('无法识别当前会话上下文');
        const { resolved, profile } = eff;

        // 列出
        if (this.id === BUILTIN_ARG_LIST) {
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
            const channel = config.getChannel(eff.session.channelId);
            return [
                mdTitle('当前 Saver'),
                mdItem('生效值', resolved.saver ? mdCode(cur) : cur),
                mdItem('使用渠道默认', mdChannelDefaultUsage(profile.saver, channel?.saver)),
                '',
                `使用 ${mdCode(`/saver ${BUILTIN_ARG_LIST}`)} 查看全部，${mdCode('/saver <id>')} 切换。`,
            ].join('\n');
        }

        // 重置
        if (this.id === BUILTIN_ARG_RESET) {
            const channel = config.getChannel(eff.session.channelId);
            await channelDataService.updateProfile(profile.id, { saver: null });
            return `${mdTitle('Saver 设置已清空')}\n${mdItem('使用渠道默认', mdChannelDefaultUsage(null, channel?.saver))}${await shareHint(profile.id)}`;
        }

        // 切换
        if (!config.getSaver(this.id)) {
            return `${mdTitle('Saver 不存在', mdCode(this.id))}\n使用 ${mdCode(`/saver ${BUILTIN_ARG_LIST}`)} 查看可用项。`;
        }
        await channelDataService.updateProfile(profile.id, { saver: this.id });
        return `${mdTitle('Saver 已切换', mdCode(this.id))}\n${mdItem('使用渠道默认', '否（当前 Profile）')}${await shareHint(profile.id)}`;
    }
}

/**
 * /note 命令 - 查看 / 列出 / 调整当前会话的 Note 列表
 */
@Command('note', '查看、列出或调整当前会话的 Note 列表')
export class NoteCommand implements ICommand {
    _context!: CommandContext;

    @Arg('action', {
        description: `${BUILTIN_ARG_LIST} 列出全部；${BUILTIN_ARG_ADD} <id> 添加；${BUILTIN_ARG_REMOVE} <id> 移除；不传则查看当前`,
        required: false,
    })
    action?: string;

    @Arg('id', {
        description: 'Note ID',
        required: false,
    })
    id?: string;

    async execute(): Promise<string> {
        const eff = await resolveEff(this._context);
        if (!eff) return mdTitle('无法识别当前会话上下文');
        const { resolved, profile } = eff;

        const ownNotes = parseNotes(profile.notes);
        const noteName = (id: string) => config.getNote(id)?.name;

        // 列出可用配置
        if (this.action === BUILTIN_ARG_LIST) {
            const notes = Object.entries(config.settings.notes ?? {})
                .sort(([a], [b]) => a.localeCompare(b));
            if (notes.length === 0) return mdTitle('没有可用的 Note');
            return `${mdTitle('可用 Note')}\n` + notes
                .map(([id, note]) => {
                    const embedding = note.embedding ? `embedding ${mdCode(note.embedding)}` : 'BM25';
                    return `- ${mdNamedRef(id, note.name)} · ${embedding}`;
                })
                .join('\n');
        }

        // 查看当前列表
        if (!this.action) {
            return [
                mdTitle('当前 Note 列表'),
                mdItem('Profile 列表', mdRefList(ownNotes, noteName)),
                mdItem('生效列表', mdRefList(resolved.notes, noteName)),
                mdItem('合并渠道默认', profile.useChannelNotes ? '是' : '否'),
                '',
                `使用 ${mdCode(`/note ${BUILTIN_ARG_LIST}`)} 查看全部，${mdCode(`/note ${BUILTIN_ARG_ADD} <id>`)} 添加，${mdCode(`/note ${BUILTIN_ARG_REMOVE} <id>`)} 移除。`,
            ].join('\n');
        }

        if (this.action !== BUILTIN_ARG_ADD && this.action !== BUILTIN_ARG_REMOVE) {
            return `${mdTitle('不支持的 Note 操作', mdCode(this.action))}\n可用操作：${mdCode(BUILTIN_ARG_LIST)} / ${mdCode(BUILTIN_ARG_ADD)} / ${mdCode(BUILTIN_ARG_REMOVE)}`;
        }
        if (!this.id) {
            return `${mdTitle('缺少 Note ID')}\n用法：${mdCode(`/note ${this.action} <id>`)}`;
        }

        // 添加
        if (this.action === BUILTIN_ARG_ADD) {
            if (!config.getNote(this.id)) {
                return `${mdTitle('Note 不存在', mdCode(this.id))}\n使用 ${mdCode(`/note ${BUILTIN_ARG_LIST}`)} 查看可用项。`;
            }
            if (ownNotes.includes(this.id)) {
                return mdTitle('Note 已在当前 Profile 列表中', mdCode(this.id));
            }
            const next = [...ownNotes, this.id];
            await channelDataService.updateProfile(profile.id, { notes: next });
            return [
                mdTitle('Note 已添加', mdCode(this.id)),
                mdItem('Profile 列表', mdRefList(next, noteName)),
                await shareHint(profile.id),
            ].filter(Boolean).join('\n');
        }

        // 移除
        if (!ownNotes.includes(this.id)) {
            return `${mdTitle('Note 不在当前 Profile 列表中', mdCode(this.id))}\n如果它来自渠道默认，请在渠道配置中调整，或关闭合并渠道默认。`;
        }
        const next = ownNotes.filter(id => id !== this.id);
        await channelDataService.updateProfile(profile.id, { notes: next });
        return [
            mdTitle('Note 已移除', mdCode(this.id)),
            mdItem('Profile 列表', mdRefList(next, noteName)),
            await shareHint(profile.id),
        ].filter(Boolean).join('\n');
    }
}

/**
 * /wiki 命令 - 查看 / 列出 / 调整当前会话的 Wiki 列表
 */
@Command('wiki', '查看、列出或调整当前会话的 Wiki 列表')
export class WikiCommand implements ICommand {
    _context!: CommandContext;

    @Arg('action', {
        description: `${BUILTIN_ARG_LIST} 列出全部；${BUILTIN_ARG_ADD} <id> 添加；${BUILTIN_ARG_REMOVE} <id> 移除；不传则查看当前`,
        required: false,
    })
    action?: string;

    @Arg('id', {
        description: 'Wiki ID',
        required: false,
    })
    id?: string;

    async execute(): Promise<string> {
        const eff = await resolveEff(this._context);
        if (!eff) return mdTitle('无法识别当前会话上下文');
        const { resolved, profile } = eff;

        const ownWikis = parseNotes(profile.wikis);
        const wikiName = (id: string) => config.getWiki(id)?.name;

        // 列出可用配置
        if (this.action === BUILTIN_ARG_LIST) {
            const wikis = Object.entries(config.settings.wikis ?? {})
                .sort(([a], [b]) => a.localeCompare(b));
            if (wikis.length === 0) return mdTitle('没有可用的 Wiki');
            return `${mdTitle('可用 Wiki')}\n` + wikis
                .map(([id, wiki]) => {
                    const embedding = wiki.embedding ? `embedding ${mdCode(wiki.embedding)}` : 'BM25';
                    return `- ${mdNamedRef(id, wiki.name)} · ${embedding}`;
                })
                .join('\n');
        }

        // 查看当前列表
        if (!this.action) {
            return [
                mdTitle('当前 Wiki 列表'),
                mdItem('Profile 列表', mdRefList(ownWikis, wikiName)),
                mdItem('生效列表', mdRefList(resolved.wikis, wikiName)),
                mdItem('合并渠道默认', profile.useChannelWikis ? '是' : '否'),
                '',
                `使用 ${mdCode(`/wiki ${BUILTIN_ARG_LIST}`)} 查看全部，${mdCode(`/wiki ${BUILTIN_ARG_ADD} <id>`)} 添加，${mdCode(`/wiki ${BUILTIN_ARG_REMOVE} <id>`)} 移除。`,
            ].join('\n');
        }

        if (this.action !== BUILTIN_ARG_ADD && this.action !== BUILTIN_ARG_REMOVE) {
            return `${mdTitle('不支持的 Wiki 操作', mdCode(this.action))}\n可用操作：${mdCode(BUILTIN_ARG_LIST)} / ${mdCode(BUILTIN_ARG_ADD)} / ${mdCode(BUILTIN_ARG_REMOVE)}`;
        }
        if (!this.id) {
            return `${mdTitle('缺少 Wiki ID')}\n用法：${mdCode(`/wiki ${this.action} <id>`)}`;
        }

        // 添加
        if (this.action === BUILTIN_ARG_ADD) {
            if (!config.getWiki(this.id)) {
                return `${mdTitle('Wiki 不存在', mdCode(this.id))}\n使用 ${mdCode(`/wiki ${BUILTIN_ARG_LIST}`)} 查看可用项。`;
            }
            if (ownWikis.includes(this.id)) {
                return mdTitle('Wiki 已在当前 Profile 列表中', mdCode(this.id));
            }
            const next = [...ownWikis, this.id];
            await channelDataService.updateProfile(profile.id, { wikis: next });
            return [
                mdTitle('Wiki 已添加', mdCode(this.id)),
                mdItem('Profile 列表', mdRefList(next, wikiName)),
                await shareHint(profile.id),
            ].filter(Boolean).join('\n');
        }

        // 移除
        if (!ownWikis.includes(this.id)) {
            return `${mdTitle('Wiki 不在当前 Profile 列表中', mdCode(this.id))}\n如果它来自渠道默认，请在渠道配置中调整，或关闭合并渠道默认。`;
        }
        const next = ownWikis.filter(id => id !== this.id);
        await channelDataService.updateProfile(profile.id, { wikis: next });
        return [
            mdTitle('Wiki 已移除', mdCode(this.id)),
            mdItem('Profile 列表', mdRefList(next, wikiName)),
            await shareHint(profile.id),
        ].filter(Boolean).join('\n');
    }
}

/**
 * /memory 命令 - 查看 / 列出 / 切换 Memory Profile
 */
@Command('memory', '查看、列出或切换当前会话的 Memory Profile')
export class MemoryCommand implements ICommand {
    _context!: CommandContext;

    @Arg('id', {
        description: `Memory Profile ID；传 ${BUILTIN_ARG_LIST} 列出全部；传 ${BUILTIN_ARG_RESET} 回退渠道默认；不传则查看当前`,
        required: false,
    })
    id?: string;

    async execute(): Promise<string> {
        const eff = await resolveEff(this._context);
        if (!eff) return mdTitle('无法识别当前会话上下文');
        const { resolved, profile } = eff;

        // 列出
        if (this.id === BUILTIN_ARG_LIST) {
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
            const channel = config.getChannel(eff.session.channelId);
            const current = resolved.memory
                ? `${mdNamedRef(resolved.memory, p?.name)}${p ? ` · ${mdEnabled(p.enabled)}` : '（配置不存在）'}`
                : cur;
            return [
                mdTitle('当前 Memory Profile'),
                mdItem('生效值', current),
                mdItem('使用渠道默认', mdChannelDefaultUsage(profile.memory, channel?.memory)),
                '',
                `使用 ${mdCode(`/memory ${BUILTIN_ARG_LIST}`)} 查看全部，${mdCode('/memory <id>')} 切换。`,
            ].join('\n');
        }

        // 重置
        if (this.id === BUILTIN_ARG_RESET) {
            const channel = config.getChannel(eff.session.channelId);
            await channelDataService.updateProfile(profile.id, { memory: null });
            return `${mdTitle('Memory Profile 设置已清空')}\n${mdItem('使用渠道默认', mdChannelDefaultUsage(null, channel?.memory))}${await shareHint(profile.id)}`;
        }

        // 切换
        if (!config.getMemoryProfile(this.id)) {
            return `${mdTitle('Memory Profile 不存在', mdCode(this.id))}\n使用 ${mdCode(`/memory ${BUILTIN_ARG_LIST}`)} 查看可用项。`;
        }
        await channelDataService.updateProfile(profile.id, { memory: this.id });
        return `${mdTitle('Memory Profile 已切换', mdCode(this.id))}\n${mdItem('使用渠道默认', '否（当前 Profile）')}${await shareHint(profile.id)}`;
    }
}

/**
 * /agenda 命令 - 查看 / 列出 / 切换 Agenda Profile
 */
@Command('agenda', '查看、列出或切换当前会话的 Agenda Profile')
export class AgendaCommand implements ICommand {
    _context!: CommandContext;

    @Arg('id', {
        description: `Agenda Profile ID；传 ${BUILTIN_ARG_LIST} 列出全部；传 ${BUILTIN_ARG_RESET} 回退渠道默认；不传则查看当前`,
        required: false,
    })
    id?: string;

    async execute(): Promise<string> {
        const eff = await resolveEff(this._context);
        if (!eff) return mdTitle('无法识别当前会话上下文');
        const { resolved, profile } = eff;

        // 列出
        if (this.id === BUILTIN_ARG_LIST) {
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
            const channel = config.getChannel(eff.session.channelId);
            const current = resolved.agenda
                ? `${mdNamedRef(resolved.agenda, p?.name)}${p ? ` · ${mdEnabled(p.enabled)}` : '（配置不存在）'}`
                : cur;
            return [
                mdTitle('当前 Agenda Profile'),
                mdItem('生效值', current),
                mdItem('使用渠道默认', mdChannelDefaultUsage(profile.agenda, channel?.agenda)),
                '',
                `使用 ${mdCode(`/agenda ${BUILTIN_ARG_LIST}`)} 查看全部，${mdCode('/agenda <id>')} 切换。`,
            ].join('\n');
        }

        // 重置
        if (this.id === BUILTIN_ARG_RESET) {
            const channel = config.getChannel(eff.session.channelId);
            await channelDataService.updateProfile(profile.id, { agenda: null });
            return `${mdTitle('Agenda Profile 设置已清空')}\n${mdItem('使用渠道默认', mdChannelDefaultUsage(null, channel?.agenda))}${await shareHint(profile.id)}`;
        }

        // 切换
        if (!config.getAgendaProfile(this.id)) {
            return `${mdTitle('Agenda Profile 不存在', mdCode(this.id))}\n使用 ${mdCode(`/agenda ${BUILTIN_ARG_LIST}`)} 查看可用项。`;
        }
        await channelDataService.updateProfile(profile.id, { agenda: this.id });
        return `${mdTitle('Agenda Profile 已切换', mdCode(this.id))}\n${mdItem('使用渠道默认', '否（当前 Profile）')}${await shareHint(profile.id)}`;
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
        new NoteCommand(),
        new WikiCommand(),
        new MemoryCommand(),
        new AgendaCommand(),
        new AutoApproveCommand(),
        new TokensCommand(),
        new VersionCommand(),
        new HistoryCommand(),
    ];
}
