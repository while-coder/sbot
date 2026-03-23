import { LarkService, LarkActionArgs, LarkMessageArgs, LarkUserIdType } from "channel.lark";
import { SlackService, SlackMessageArgs, SlackActionArgs } from "channel.slack";
import { database, type ChannelSessionRow } from "../Core/Database";
import { NowDate } from "scorpio.ai";
import { Op } from "sequelize";
import { userService } from "../UserService/UserService";
import { LoggerService } from "../Core/LoggerService";
import { config, ChannelType, ChannelConfig } from "../Core/Config";

const logger = LoggerService.getLogger("ChannelManager.ts");

// ── 事件去重 ──────────────────────────────────────────────────────────────────

const HourMilliseconds = 1000 * 60 * 60;
const CheckInterval = HourMilliseconds;
const ExpireTime = HourMilliseconds * 24 * 3;
let checkTime = 0;

async function clearExpiredMessage() {
    const now = NowDate();
    if (now < checkTime) return;
    checkTime = now + CheckInterval;
    await database.destroy(database.message, { where: { expireTime: { [Op.lt]: now } } });
}

async function filterEvent(eventId: string): Promise<boolean> {
    await clearExpiredMessage();
    if ((await database.count(database.message, { where: { id: eventId } })) > 0) return false;
    await database.create(database.message, { id: eventId, expireTime: NowDate() + ExpireTime });
    return true;
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
            filterEvent,
            onReceiveMessage: async (userId: string, userInfo: any, args: SlackMessageArgs, query: string) => {
                const [, created] = await database.findOrCreate(database.channelUser, {
                    where: { userid: userId, channel: channelId },
                    defaults: {
                        username:   userInfo?.real_name ?? userInfo?.name ?? "",
                        userinfo:   JSON.stringify(userInfo ?? {}),
                        userIdType: "slack_id",
                    },
                });
                if (!created) {
                    await database.update(database.channelUser,
                        { username: userInfo?.real_name ?? userInfo?.name ?? "", userinfo: JSON.stringify(userInfo ?? {}) },
                        { where: { userid: userId, channel: channelId } },
                    );
                }
                const [dbSession, sessionCreated] = await database.findOrCreate<ChannelSessionRow>(database.channelSession, {
                    where: { channel: channelId, sessionId: args.channel },
                    defaults: { name: args.channel, agentId: "", memoryId: null },
                });
                if (!sessionCreated) {
                    await database.update(database.channelSession,
                        { name: args.channel },
                        { where: { channel: channelId, sessionId: args.channel } },
                    );
                }
                const dbSessionId: number = (dbSession as any).id;
                await userService.onReceiveSlackMessage(query, args, userInfo ?? {}, channelId, dbSessionId);
            },
            onTriggerAction: async (_userId: string, args: SlackActionArgs) => {
                // NOTE: userService.slack is a singleton; concurrent tool approvals from
                // different users in the same workspace may collide. Acceptable for now,
                // same as the Lark channel pattern.
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
        const userIdType = LarkUserIdType.UnionId
        const service = new LarkService({
            appId: channel.appId,
            appSecret: channel.appSecret,
            logger: logger,
            userIdType: userIdType,
            filterEvent,
            onRecevieMessage: async (userId: string, userInfo: any, chatInfo: any, args: LarkMessageArgs, query: string) => {
                const userName = userInfo?.name ?? ''
                const userAvatar = userInfo?.avatar?.avatar_origin
                const [, created] = await database.findOrCreate(database.channelUser, {
                    where: { userid: userId, channel: channelId },
                    defaults: {
                        username:   userName,
                        userinfo:   JSON.stringify(userInfo ?? {}),
                        userIdType: userIdType,
                        avatar:     userAvatar,
                    },
                });
                if (!created) {
                    await database.update(database.channelUser,
                        { username: userName, userinfo: JSON.stringify(userInfo ?? {}), userIdType: userIdType, avatar: userAvatar },
                        { where: { userid: userId, channel: channelId } },
                    );
                }
                const sessionName = chatInfo ? (chatInfo?.chat_mode == 'p2p' ? `p2p_${userId}` : `${chatInfo?.chat_mode}_${chatInfo?.name}`) : '';
                const sessionAvatar = chatInfo?.avatar || '';
                const [dbSession, sessionCreated] = await database.findOrCreate<ChannelSessionRow>(database.channelSession, {
                    where: { channel: channelId, sessionId: args.chat_id },
                    defaults: { name: sessionName, avatar: sessionAvatar, agentId: "", memoryId: null, workPath: null },
                });
                if (!sessionCreated) {
                    await database.update(database.channelSession,
                        { name: sessionName, avatar: sessionAvatar },
                        { where: { channel: channelId, sessionId: args.chat_id } },
                    );
                }
                const dbSessionId: number = (dbSession as any).id;
                await userService.onReceiveLarkMessage(query, args, userInfo ?? {}, channelId, dbSessionId);
            },
            onTriggerAction: async (_userId: string, _userInfo: any, _chatInfo: any, args: LarkActionArgs) => {
                await userService.lark.onTriggerAction(args.chat_id, args.code, args.data, args.form_value);
            },
        });
        await service.registerEventDispatcher();
        logger.info(`Lark channel [${channel.name || channelId}] started successfully`);
        return service;
    }
}

export const channelManager = new ChannelManager();
