import { LarkService, LarkReceiveIdType, LarkActionArgs, LarkMessageArgs, LarkUserIdType } from "channel.lark";
import { SlackService, SlackMessageArgs, SlackActionArgs } from "channel.slack";
import { WecomService, WecomMessageArgs, WecomActionArgs } from "channel.wecom";
import { ChannelUserRow, database, type ChannelSessionRow } from "../Core/Database";
import { NowDate } from "scorpio.ai";
import { Op } from "sequelize";
import { userService } from "../UserService/UserService";
import { LoggerService } from "../Core/LoggerService";
import { config, ChannelType, ChannelConfig } from "../Core/Config";
import { compareSemver, fetchLatestRelease } from "sbot.commons";

const logger = LoggerService.getLogger("ChannelManager.ts");

// ── 事件去重 ──────────────────────────────────────────────────────────────────

const HourMilliseconds = 1000 * 60 * 60;
const CheckInterval = HourMilliseconds;
const ExpireTime = HourMilliseconds * 24 * 3;
let checkTime = 0;

async function filterEvent(eventId: string): Promise<boolean> {
    const now = NowDate();
    if (now >= checkTime) {
        checkTime = now + CheckInterval;
        await database.destroy(database.message, { where: { expireTime: { [Op.lt]: now } } });
    }
    if ((await database.count(database.message, { where: { id: eventId } })) > 0) return false;
    await database.create(database.message, { id: eventId, expireTime: now + ExpireTime });
    return true;
}

// ── 更新检查 ──────────────────────────────────────────────────────────────────

async function checkForUpdate(sendMessage: (msg: string) => Promise<void>): Promise<void> {
    const now = NowDate();
    const checkUpdateTime = config.settings.checkUpdateTime ?? 0;
    if (now < checkUpdateTime) return;

    // 先更新时间，避免并发消息重复触发
    config.setCheckUpdateTime(now + HourMilliseconds);

    const latest = await fetchLatestRelease();
    if (latest && compareSemver(config.pkg.version, latest.tag) < 0) {
        const note = latest.releasenoteEn || latest.releasenoteZh;
        const releasenoteSection = note ? `\n\n**What's new:**\n${note}` : '';
        const message = [
            `## 🎉 New version available: ${latest.tag}`,
            ``,
            `Current version: **v${config.pkg.version}**`,
            `Latest version: **${latest.tag}**`,
            ``,
            `**Update command:**`,
            `\`\`\``,
            `npm install -g @qingfeng346/sbot@latest`,
            `\`\`\``,
            ``,
            `[View release notes](${latest.url})${releasenoteSection}`,
        ].join('\n');
        await sendMessage(message);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(0, 0, 0, 0);
        config.setCheckUpdateTime(tomorrow.getTime());
    }
}

// ── DB 辅助函数 ───────────────────────────────────────────────────────────────

interface ReceiveMessageContext {
    channelId: string;
    userId: string;
    userName: string;
    userInfo: string;
    sessionId: string;
    sessionName: string;
    processMessage: (dbSessionId: number) => Promise<void>;
    sendUpdate: (msg: string) => Promise<void>;
    userAvatar?: string;
    sessionAvatar?: string;
}

async function handleReceiveMessage(ctx: ReceiveMessageContext): Promise<void> {
    const { channelId, userId, userName, userInfo, sessionId, sessionName, processMessage, sendUpdate, userAvatar, sessionAvatar } = ctx;
    const userData: Record<string, any> = { userName, userInfo };
    if (userAvatar !== undefined) userData.avatar = userAvatar;
    const [, userCreated] = await database.findOrCreate<ChannelUserRow>(database.channelUser, {
        where: { userId, channelId },
        defaults: userData,
    });
    if (!userCreated) {
        await database.update(database.channelUser, userData, { where: { channelId, userId } });
    }

    const sessionData: Record<string, any> = { sessionName };
    if (sessionAvatar !== undefined) sessionData.avatar = sessionAvatar;
    const [dbSession, sessionCreated] = await database.findOrCreate<ChannelSessionRow>(database.channelSession, {
        where: { channelId, sessionId },
        defaults: { ...sessionData, agentId: null },
    });
    if (!sessionCreated) {
        await database.update(database.channelSession, sessionData, { where: { channelId, sessionId } });
    }

    await processMessage((dbSession as any).id);
    checkForUpdate(sendUpdate).catch(() => {});
}

// ── 频道 Handler 接口 ─────────────────────────────────────────────────────────

export interface IChannelService {
    dispose?(): void;
}

/**
 * 频道初始化函数类型。
 * 每种 ChannelType 注册一个对应的初始化函数，返回可卸载的服务实例。
 */
export type ChannelInitFn = (
    channelId: string,
    channel: ChannelConfig,
) => Promise<IChannelService | undefined>;

// ── ChannelManager ────────────────────────────────────────────────────────────

export class ChannelManager {
    /** 各 ChannelType 对应的初始化函数 */
    private initializers = new Map<ChannelType, ChannelInitFn>();
    /** 已启动的频道服务实例，key 为 channelId */
    private services = new Map<string, IChannelService>();

    constructor() {
        // 注册内置频道类型
        this.register(ChannelType.Lark, this.initLark.bind(this));
        this.register(ChannelType.Slack, this.initSlack.bind(this));
        this.register(ChannelType.Wecom, this.initWecom.bind(this));
    }

    /**
     * 注册频道类型初始化函数（支持扩展新类型）
     */
    register(type: ChannelType, init: ChannelInitFn): void {
        this.initializers.set(type, init);
    }

    /**
     * 初始化所有已配置的频道
     */
    async init(): Promise<void> {
        const channels = Object.entries(config.settings.channels || {}) as [string, ChannelConfig][];
        if (channels.length === 0) {
            logger.info("No channel configuration, skipping startup");
            return;
        }
        let started = 0;
        for (const [channelId, channel] of channels) {
            const initializer = this.initializers.get(channel.type as ChannelType);
            if (!initializer) {
                logger.warn(`Unknown channel type [${channel.type}], skipping channel [${channel.name || channelId}]`);
                continue;
            }
            try {
                const service = await initializer(channelId, channel);
                if (service) {
                    this.services.set(channelId, service);
                    started++;
                }
            } catch (e) {
                logger.error(`Channel [${channel.name || channelId}] failed to start: ${e}`);
            }
        }
        logger.info(`ChannelManager initialized, started ${started} channel(s)`);
    }

    /**
     * 卸载所有频道服务
     */
    async dispose(): Promise<void> {
        for (const [channelId, service] of this.services) {
            try {
                service.dispose?.();
                logger.info(`Channel [${channelId}] disposed`);
            } catch (e) {
                logger.error(`Failed to dispose channel [${channelId}]: ${e}`);
            }
        }
        this.services.clear();
    }

    /**
     * 重新加载所有频道
     */
    async reload(): Promise<void> {
        await this.dispose();
        await this.init();
        logger.info("ChannelManager reload completed");
    }

    /**
     * 获取指定频道配置
     */
    getChannel(channelId: string): ChannelConfig | undefined {
        return config.getChannel(channelId);
    }

    /**
     * 获取已启动的频道服务实例
     */
    getService(channelId: string): IChannelService | undefined {
        return this.services.get(channelId);
    }

    // ── Lark 频道初始化 ───────────────────────────────────────────────────────

    // ── Slack 频道初始化 ──────────────────────────────────────────────────────

    private async initSlack(channelId: string, channel: ChannelConfig): Promise<IChannelService | undefined> {
        if (!channel.botToken?.trim() || !channel.appToken?.trim()) {
            logger.warn(`Slack channel [${channel.name || channelId}] missing botToken or appToken, skipping`);
            return undefined;
        }
        const service = new SlackService({
            botToken: channel.botToken,
            appToken: channel.appToken,
            logger: logger,
            onReceiveMessage: async (userId: string, userInfo: any, args: SlackMessageArgs, query: string) => {
                await handleReceiveMessage({
                    channelId, userId,
                    userName: userInfo?.real_name ?? userInfo?.name ?? "",
                    userInfo: JSON.stringify(userInfo ?? {}),
                    sessionId: args.channel,
                    sessionName: args.channel,
                    processMessage: (dbSessionId: number) => userService.onReceiveSlackMessage(query, args, userInfo ?? {}, channelId, dbSessionId),
                    sendUpdate: (msg: string) => service.sendMessage(args.channel, msg).then(() => {}),
                });
            },
            onTriggerAction: async (_userId: string, args: SlackActionArgs) => {
                await userService.slack.onTriggerAction(args);
            },
        });
        await service.registerEventHandlers();
        logger.info(`Slack channel [${channel.name || channelId}] started successfully`);
        return service;
    }

    // ── Lark 频道初始化 ───────────────────────────────────────────────────────

    private async initLark(channelId: string, channel: ChannelConfig): Promise<IChannelService | undefined> {
        if (!channel.appId?.trim() || !channel.appSecret?.trim()) {
            logger.warn(`Lark channel [${channel.name || channelId}] missing appId or appSecret, skipping`);
            return undefined;
        }
        const service = new LarkService({
            appId: channel.appId,
            appSecret: channel.appSecret,
            logger: logger,
            userIdType: LarkUserIdType.UnionId,
            filterEvent,
            onRecevieMessage: async (userId: string, userInfo: any, chatInfo: any, args: LarkMessageArgs, query: string) => {
                const sessionName = chatInfo ? (chatInfo?.chat_mode == 'p2p' ? `p2p_${userId}` : `${chatInfo?.chat_mode}_${chatInfo?.name}`) : '';
                await handleReceiveMessage({
                    channelId,
                    userId,
                    userName: userInfo?.name ?? '',
                    userInfo: JSON.stringify(userInfo ?? {}),
                    sessionId: args.chat_id,
                    sessionName,
                    processMessage: (dbSessionId: number) => userService.onReceiveLarkMessage(query, args, userInfo ?? {}, channelId, dbSessionId),
                    sendUpdate: (msg: string) => service.sendMarkdownMessage(LarkReceiveIdType.ChatId, args.chat_id, msg).then(() => {}),
                    userAvatar: userInfo?.avatar?.avatar_origin,
                    sessionAvatar: chatInfo?.avatar || '',
                });
            },
            onTriggerAction: async (_userId: string, _userInfo: any, _chatInfo: any, args: LarkActionArgs) => {
                await userService.lark.onTriggerAction(args.chat_id, args.code, args.data, args.form_value);
            },
        });
        await service.registerEventDispatcher();
        logger.info(`Lark channel [${channel.name || channelId}] started successfully`);
        return service;
    }

    // ── WeCom 频道初始化 ──────────────────────────────────────────────────────

    private async initWecom(channelId: string, channel: ChannelConfig): Promise<IChannelService | undefined> {
        if (!channel.botId?.trim() || !channel.secret?.trim()) {
            logger.warn(`WeCom channel [${channel.name || channelId}] missing botId or secret, skipping`);
            return undefined;
        }
        const service = new WecomService({
            botId: channel.botId,
            secret: channel.secret,
            logger: logger,
            filterEvent,
            onReceiveMessage: async (userId: string, args: WecomMessageArgs, query: string) => {
                await handleReceiveMessage({
                    channelId,
                    userId,
                    userName: userId,
                    userInfo: JSON.stringify({ userId: userId }),
                    sessionId: args.chatid,
                    sessionName: args.chatid,
                    processMessage: (dbSessionId: number) => userService.onReceiveWecomMessage(query, args, { userId: userId }, channelId, dbSessionId),
                    sendUpdate: (msg: string) => service.sendMessage(args.chatid, { msgtype: 'markdown', markdown: { content: msg } }).then(() => {}),
                });
            },
            onTriggerAction: async (userId: string, args: WecomActionArgs) => {
                await userService.wecom.onTriggerAction(userId, args);
            },
        });
        service.connect();
        logger.info(`WeCom channel [${channel.name || channelId}] started successfully`);
        return service;
    }
}

export const channelManager = new ChannelManager();
