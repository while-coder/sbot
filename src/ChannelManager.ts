import { LarkService, LarkActionArgs, LarkMessageArgs, LarkUserIdType } from "winning.ai";
import { database } from "./Database";
import { NowDate } from "./Utils";
import { Op } from "sequelize";
import { userService } from "./UserService/UserService";
import { LoggerService } from "./LoggerService";
import { config, ChannelType, ChannelConfig } from "./Config";

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
            logger.info("无频道配置，跳过启动");
            return;
        }
        let started = 0;
        for (const [channelId, channel] of channels) {
            const initializer = this.initializers.get(channel.type as ChannelType);
            if (!initializer) {
                logger.warn(`未知频道类型 [${channel.type}]，跳过频道 [${channel.name || channelId}]`);
                continue;
            }
            try {
                const service = await initializer(channelId, channel);
                if (service) {
                    this.services.set(channelId, service);
                    started++;
                }
            } catch (e) {
                logger.error(`频道 [${channel.name || channelId}] 启动失败: ${e}`);
            }
        }
        logger.info(`ChannelManager 初始化完成，共启动 ${started} 个频道`);
    }

    /**
     * 卸载所有频道服务
     */
    async dispose(): Promise<void> {
        for (const [channelId, service] of this.services) {
            try {
                service.dispose?.();
                logger.info(`频道 [${channelId}] 已卸载`);
            } catch (e) {
                logger.error(`卸载频道 [${channelId}] 失败: ${e}`);
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
        logger.info("ChannelManager 重载完成");
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

    private async initLark(channelId: string, channel: ChannelConfig): Promise<IChannelService | undefined> {
        if (!channel.appId?.trim() || !channel.appSecret?.trim()) {
            logger.warn(`Lark 频道 [${channel.name || channelId}] 缺少 appId 或 appSecret，跳过`);
            return undefined;
        }
        const service = new LarkService({
            appId: channel.appId,
            appSecret: channel.appSecret,
            userIdType: LarkUserIdType.UnionId,
            filterEvent,
            onRecevieMessage: async (userId: string, userInfo: any, args: LarkMessageArgs, query: string) => {
                if (userId) {
                    const [, created] = await database.findOrCreate(database.user, {
                        where: { userid: userId, channel: channelId },
                        defaults: {
                            username: userInfo?.name ?? "",
                            userinfo: JSON.stringify(userInfo ?? {}),
                        },
                    });
                    if (!created) {
                        await database.update(database.user,
                            { username: userInfo?.name ?? "", userinfo: JSON.stringify(userInfo ?? {}) },
                            { where: { userid: userId, channel: channelId } },
                        );
                    }
                }
                await userService.onReceiveLarkMessage(args, userInfo, query, channelId);
            },
            onTriggerAction: async (_userId: string, _userInfo: any, args: LarkActionArgs) => {
                await userService.lark.onTriggerAction(args.chat_id, args.code, args.data, args.form_value);
            },
        });
        await service.registerEventDispatcher();
        logger.info(`Lark 频道 [${channel.name || channelId}] 启动成功`);
        return service;
    }
}

export const channelManager = new ChannelManager();
