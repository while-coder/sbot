import { LarkService, LarkActionArgs, LarkMessageArgs, LarkUserIdType } from "winning.ai";
import { database } from "./Database";
import { NowDate } from "./Utils";
import { Op } from "sequelize";
import { userService } from "./UserService/UserService";
import { LoggerService } from "./LoggerService";
import { config, ChannelType, ChannelConfig } from "./Config";

const logger = LoggerService.getLogger("ChannelManager.ts");

const HourMilliseconds = 1000 * 60 * 60;
const CheckInterval = HourMilliseconds;
const ExpireTime = HourMilliseconds * 24 * 3;

let checkTime = 0;

async function clearExpiredMessage() {
    const now = NowDate();
    if (now < checkTime) return;
    checkTime = now + CheckInterval;
    await database.destroy(database.message, {
        where: { expireTime: { [Op.lt]: now } },
    });
}

async function filterEvent(eventId: string): Promise<boolean> {
    await clearExpiredMessage();
    if ((await database.count(database.message, { where: { id: eventId } })) > 0) return false;
    await database.create(database.message, { id: eventId, expireTime: NowDate() + ExpireTime });
    return true;
}

export class ChannelManager {
    private larkServices = new Map<string, LarkService>();

    /**
     * 获取所有已配置的 Lark 频道（需有 appId 和 appSecret）
     */
    getLarkChannels(): [string, ChannelConfig][] {
        return Object.entries(config.settings.channels || {})
            .filter(([, c]) => c.type === ChannelType.Lark && c.appId?.trim() && c.appSecret?.trim()) as [string, ChannelConfig][];
    }

    /**
     * 获取指定频道配置
     */
    getChannel(channelId: string): ChannelConfig | undefined {
        return config.getChannel(channelId);
    }

    /**
     * 获取所有已启动的 Lark 服务实例
     */
    getActiveLarkServices(): Map<string, LarkService> {
        return this.larkServices;
    }

    /**
     * 初始化所有 Lark 频道
     */
    async init(): Promise<void> {
        const channels = this.getLarkChannels();
        if (channels.length === 0) {
            logger.info("无 Lark 频道配置，跳过启动");
            return;
        }
        for (const [channelId, channel] of channels) {
            await this.startChannel(channelId, channel);
        }
        logger.info(`ChannelManager 初始化完成，共 ${channels.length} 个 Lark 频道`);
    }

    /**
     * 卸载所有频道服务
     */
    async dispose(): Promise<void> {
        for (const [channelId, service] of this.larkServices) {
            try {
                service.dispose?.();
                logger.info(`Lark 频道 [${channelId}] 已卸载`);
            } catch (e) {
                logger.error(`卸载 Lark 频道 [${channelId}] 失败: ${e}`);
            }
        }
        this.larkServices.clear();
    }

    /**
     * 重新加载所有频道（先卸载再初始化）
     */
    async reload(): Promise<void> {
        await this.dispose();
        await this.init();
        logger.info("ChannelManager 重载完成");
    }

    /**
     * 启动单个 Lark 频道
     */
    private async startChannel(channelId: string, channel: ChannelConfig): Promise<void> {
        const service = new LarkService({
            appId: channel.appId!,
            appSecret: channel.appSecret!,
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
        this.larkServices.set(channelId, service);
        logger.info(`Lark 频道 [${channel.name || channelId}] 启动成功`);
    }
}

export const channelManager = new ChannelManager();
