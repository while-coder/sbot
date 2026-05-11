import { ChannelPlugin, ChannelPluginContext, IChannelService, ChannelSessionInfo } from "channel.base";
import { ChannelUserRow, database, type ChannelSessionRow } from "../Core/Database";
import { NowDate } from "scorpio.ai/Core";
import { Op } from "sequelize";
import { sessionManager } from "../Session/SessionManager";
import { LoggerService } from "../Core/LoggerService";
import { config } from "../Core/Config";
import { compareSemver, fetchLatestRelease, WEB_CHANNEL_ID, WEB_CHANNEL_TYPE } from "sbot.commons";
import { channelThreadId } from "../Core/Database";
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
        const next = new Date();
        next.setDate(next.getDate() + 5);
        next.setHours(0, 0, 0, 0);
        config.setCheckUpdateTime(next.getTime());
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
        for (const [channelId] of channels) {
            if (await this.startChannel(channelId)) started++;
        }
        logger.info(`ChannelManager initialized, started ${started} channel(s)`);
    }

    private async startChannel(channelId: string): Promise<boolean> {
        const channel = config.getChannel(channelId);
        if (!channel) return false;

        if (channel.type === WEB_CHANNEL_TYPE) return false;

        const plugin = this.plugins.get(channel.type);
        if (!plugin) {
            logger.warn(`Unknown channel type [${channel.type}], skipping channel [${channel.name || channelId}]`);
            return false;
        }
        const name = channel.name ? `${channel.name} (${channelId})` : channelId;
        const label = `[${name}] (${plugin.type})`;
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
                logger.info(`Channel ${label} started successfully`);
                return true;
            }
            logger.warn(`Channel ${label} init returned nothing, skipped`);
            return false;
        } catch (e: any) {
            logger.error(`Channel ${label} failed to start: ${e.message}\n${e.stack}`);
            return false;
        }
    }

    private stopChannel(channelId: string): void {
        const service = this.services.get(channelId);
        if (!service) return;
        const channel = config.getChannel(channelId);
        const name = channel?.name ? `${channel.name} (${channelId})` : channelId;
        const label = `[${name}] (${channel?.type})`;
        try {
            service.dispose?.();
            this.services.delete(channelId);
            logger.info(`Channel ${label} disposed`);
        } catch (e) {
            logger.error(`Channel ${label} failed to dispose: ${e}`);
        }
    }

    getPlugin(type: string): ChannelPlugin | undefined {
        return this.plugins.get(type);
    }

    getPluginList(): Array<{ type: string; label: string; configSchema: Record<string, any>; builtin: boolean }> {
        const list: Array<{ type: string; label: string; configSchema: Record<string, any>; builtin: boolean }> = [
            { type: WEB_CHANNEL_TYPE, label: 'Web', configSchema: {}, builtin: true },
        ];
        for (const p of this.plugins.values()) {
            list.push({ type: p.type, label: p.label, configSchema: p.configSchema, builtin: false });
        }
        return list;
    }

    async dispose(): Promise<void> {
        for (const [channelId] of this.services) {
            this.stopChannel(channelId);
        }
    }

    async reload(): Promise<void> {
        await this.dispose();
        await this.init();
        logger.info("ChannelManager reload completed");
    }

    async reloadChannel(channelId: string): Promise<void> {
        this.stopChannel(channelId);
        await this.startChannel(channelId);
    }

    getChannel(channelId: string) { return config.getChannel(channelId); }
    getService(channelId: string) { return this.services.get(channelId); }

    async sendText(channelId: string, sessionId: string, text: string): Promise<boolean> {
        const service = this.services.get(channelId);
        if (!service) return false;
        await service.sendText(sessionId, text);
        return true;
    }

    async sendTextToSession(dbSessionId: number, text: string): Promise<boolean> {
        try {
            const row = await database.findOne<ChannelSessionRow>(database.channelSession, { where: { id: dbSessionId } });
            if (!row) return false;
            return this.sendText(row.channelId, row.sessionId, text);
        } catch (e) {
            logger.warn(`sendTextToSession(${dbSessionId}) failed: ${e}`);
            return false;
        }
    }

    async sendFile(channelId: string, sessionId: string, file: string | Buffer, fileName?: string): Promise<boolean> {
        const service = this.services.get(channelId);
        if (!service) return false;
        await service.sendFile(sessionId, file, fileName);
        return true;
    }

    async sendNative(channelId: string, sessionId: string, payload: any): Promise<boolean> {
        const service = this.services.get(channelId);
        if (!service) return false;
        await service.sendNative(sessionId, payload);
        return true;
    }

    async loadPlugin(moduleOrPath: string): Promise<ChannelPlugin | undefined> {
        const plugin = this.pluginLoader.loadPlugin(moduleOrPath);
        if (plugin) this.plugins.set(plugin.type, plugin);
        return plugin;
    }
}

export const channelManager = new ChannelManager();
