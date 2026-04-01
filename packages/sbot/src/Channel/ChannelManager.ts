import { ChannelPlugin, ChannelPluginContext, IChannelService, ChannelSessionInfo } from "channel.base";
import { ChannelUserRow, database, type ChannelSessionRow } from "../Core/Database";
import { NowDate } from "scorpio.ai";
import { Op } from "sequelize";
import { sessionManager } from "../UserService/SessionManager";
import { LoggerService } from "../Core/LoggerService";
import { config } from "../Core/Config";
import { compareSemver, fetchLatestRelease, channelThreadId } from "sbot.commons";
import { PluginLoader } from "./PluginLoader";

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

function hasChanged(row: Record<string, any>, data: Record<string, any>): boolean {
    return Object.keys(data).some(k => row[k] !== data[k]);
}

async function doInitSession(channelId: string, ctx: import("channel.base").InitSessionContext): Promise<{ dbUserId: number; dbSessionId: number }> {
    const { userId, userName, userInfo, sessionId, sessionName, sendUpdate, userAvatar, sessionAvatar } = ctx;
    const userData: Record<string, any> = { userName, userInfo };
    if (userAvatar !== undefined) userData.avatar = userAvatar;
    const [dbUser, userCreated] = await database.findOrCreate<ChannelUserRow>(database.channelUser, {
        where: { channelId, userId },
        defaults: userData,
    });
    if (!userCreated && hasChanged(dbUser as any, userData)) {
        await database.update(database.channelUser, userData, { where: { channelId, userId } });
    }

    const sessionData: Record<string, any> = { sessionName };
    if (sessionAvatar !== undefined) sessionData.avatar = sessionAvatar;
    const [dbSession, sessionCreated] = await database.findOrCreate<ChannelSessionRow>(database.channelSession, {
        where: { channelId, sessionId },
        defaults: sessionData,
    });
    if (!sessionCreated && hasChanged(dbSession as any, sessionData)) {
        await database.update(database.channelSession, sessionData, { where: { channelId, sessionId } });
    }

    if (sendUpdate) checkForUpdate(sendUpdate).catch(() => {});
    return { dbUserId: (dbUser as any).id, dbSessionId: (dbSession as any).id };
}

// ── ChannelManager ────────────────────────────────────────────────────────────

export class ChannelManager {
    private pluginLoader = new PluginLoader();
    private plugins = new Map<string, ChannelPlugin>();
    private services = new Map<string, IChannelService>();

    async init(): Promise<void> {
        this.plugins = await this.pluginLoader.loadAll();

        const channels = Object.entries(config.settings.channels || {});
        if (channels.length === 0) {
            logger.info("No channel configuration, skipping startup");
            return;
        }

        let started = 0;
        for (const [channelId, channel] of channels) {
            const plugin = this.plugins.get(channel.type);
            if (!plugin) {
                logger.warn(`Unknown channel type [${channel.type}], skipping channel [${channel.name || channelId}]`);
                continue;
            }
            const label = channel.name || channelId;
            try {
                const ctx: ChannelPluginContext = {
                    config: channel.config ?? {},
                    logger,
                    filterEvent,
                    initSession: async (initCtx) => {
                        const { dbUserId, dbSessionId } = await doInitSession(channelId, initCtx);
                        return { channelId, userId: initCtx.userId, sessionId: initCtx.sessionId, dbUserId, dbSessionId };
                    },
                    onReceiveMessage: (session, query, args) =>
                        sessionManager.onReceiveChannelMessage(channelThreadId(plugin.type, channelId, session.sessionId), query, { ...args, channelType: plugin.type, channelId, dbSessionId: session.dbSessionId }),
                    onTriggerAction: (session, args) =>
                        sessionManager.onChannelTriggerAction(channelThreadId(plugin.type, channelId, session.sessionId), { ...args, channelType: plugin.type, channelId }),
                };
                const service = await plugin.init(ctx);
                if (service) {
                    this.services.set(channelId, service);
                    started++;
                    logger.info(`Channel [${label}] (${plugin.type}) started successfully`);
                } else {
                    logger.warn(`Channel [${label}] (${plugin.type}) init returned nothing, skipped`);
                }
            } catch (e) {
                logger.error(`Channel [${label}] (${plugin.type}) failed to start: ${e}`);
            }
        }
        logger.info(`ChannelManager initialized, started ${started} channel(s)`);
    }

    getPlugin(type: string): ChannelPlugin | undefined {
        return this.plugins.get(type);
    }

    getPluginList(): Array<{ type: string; configSchema?: Record<string, any> }> {
        return [...this.plugins.values()].map(p => ({ type: p.type, configSchema: p.configSchema }));
    }

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

    async reload(): Promise<void> {
        await this.dispose();
        await this.init();
        logger.info("ChannelManager reload completed");
    }

    getChannel(channelId: string) { return config.getChannel(channelId); }
    getService(channelId: string) { return this.services.get(channelId); }

    async loadPlugin(moduleOrPath: string): Promise<ChannelPlugin | undefined> {
        const plugin = this.pluginLoader.loadPlugin(moduleOrPath);
        if (plugin) this.plugins.set(plugin.type, plugin);
        return plugin;
    }
}

export const channelManager = new ChannelManager();
