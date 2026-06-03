import { ApprovalTimeoutValue } from "sbot.commons";
import {
    database,
    parseMemories,
    type ChannelSessionRow,
    type SessionProfileRow,
    type ChannelUserRow,
} from "../Core/Database";
import { config } from "../Core/Config";
import { LoggerService } from "../Core/LoggerService";
import { schedulerService } from "../Scheduler/SchedulerService";
import { heartbeatService } from "../Heartbeat/HeartbeatService";

const logger = LoggerService.getLogger("ChannelDataService.ts");

// ── Effective session 类型 ────────────────────────────────────────────────────

/** profile.field ?? channel.field 合并后的最终配置 */
export interface EffectiveSessionResolved {
    agentId: string;
    saver: string;
    threadKey: string;
    memories: string[];
    wikis: string[];
    workPath?: string;
    streamVerbose?: boolean;
    autoApproveAllTools?: boolean;
    approvalTimeout?: number;
    approvalTimeoutValue?: ApprovalTimeoutValue;
    askTimeout?: number;
    askTimeoutMessage?: string;
    intentModel?: string;
    intentPrompt?: string;
    intentThreshold?: number;
}

export interface EffectiveSession {
    session: ChannelSessionRow;
    profile: SessionProfileRow;
    resolved: EffectiveSessionResolved;
}

// ── 内部小工具 ────────────────────────────────────────────────────────────────

function parseId(id: number | string | undefined | null): number | null {
    if (id == null) return null;
    const pk = typeof id === "string" ? parseInt(id) : id;
    return isNaN(pk) ? null : pk;
}

/** 仅设置非 undefined 字段：避免把 undefined 写进 update 把列覆盖成 null */
function pickDefined<T extends Record<string, any>>(obj: T): Partial<T> {
    const out: Partial<T> = {};
    for (const k of Object.keys(obj)) {
        if (obj[k] !== undefined) (out as any)[k] = obj[k];
    }
    return out;
}

// ── ChannelDataService ────────────────────────────────────────────────────────

/**
 * channel / channel_session / session_profile / channel_user 的统一持久化层。
 *
 * 职责：
 * - 只读 helper（getSession / getProfile / getEffective）
 * - 写 + 跨表级联（删 channel/session/profile 时要清的"远端"行）
 * - 复合读（list + count、profile + sessions）
 *
 * 不进入：纯单点 findByPk / findOne by 唯一键（直接走 database 即可）。
 *
 * 跨服务依赖（由本类调用，反向不允许）：
 * - schedulerService.cascadeDeleteByProfile —— scheduler 自治
 * - heartbeatService.reloadAll —— heartbeat 自治
 * - channelManager.reloadChannel —— channel 运行时自治（在 routes 层调用，避开循环）
 */
export class ChannelDataService {
    // ── reads ────────────────────────────────────────────────────────────────

    async getSession(id: number | string | undefined | null, throwIfNotFound?: boolean): Promise<ChannelSessionRow | null> {
        const pk = parseId(id);
        if (pk == null) {
            if (throwIfNotFound) throw new Error(`Invalid ChannelSession id: ${id}`);
            if (id != null) logger.warn(`getSession: invalid id "${id}"`);
            return null;
        }
        const row = await database.findByPk<ChannelSessionRow>(database.channelSession, pk);
        if (!row) {
            if (throwIfNotFound) throw new Error(`ChannelSession not found: ${pk}`);
            logger.warn(`getSession: id=${pk} not found`);
        }
        return row;
    }

    async getProfile(id: number): Promise<SessionProfileRow | null> {
        if (id <= 0) return null;
        return database.findByPk<SessionProfileRow>(database.sessionProfile, id);
    }

    /** 加载 session + 它指向的 profile + channel 默认，合并出有效配置（profile.field ?? channel.field） */
    async getEffective(id: number | string, throwIfNotFound: true): Promise<EffectiveSession>;
    async getEffective(id: number | string): Promise<EffectiveSession | undefined>;
    async getEffective(id: number | string, throwIfNotFound?: boolean): Promise<EffectiveSession | undefined> {
        const session = await this.getSession(id, throwIfNotFound);
        if (!session) return undefined;
        // ensureSession 保证 profileId > 0；找不到 profile 视为数据异常
        const profile = await this.getProfile(session.profileId);
        if (!profile) throw new Error(`SessionProfile not found: session.id=${session.id}, profileId=${session.profileId}`);
        const channel = config.getChannel(session.channelId);

        const useChannelMemories = profile.memories != null ? !!profile.useChannelMemories : false;
        const useChannelWikis = profile.wikis != null ? !!profile.useChannelWikis : false;
        const ownMems = profile.memories != null ? parseMemories(profile.memories) : [];
        const ownWikis = profile.wikis != null ? parseMemories(profile.wikis) : [];

        const resolved: EffectiveSessionResolved = {
            agentId: profile.agentId ?? channel?.agent ?? "",
            saver: profile.saver ?? channel?.saver ?? "",
            threadKey: String(profile.id),
            memories: useChannelMemories ? [...(channel?.memories ?? []), ...ownMems] : ownMems,
            wikis: useChannelWikis ? [...(channel?.wikis ?? []), ...ownWikis] : ownWikis,
            workPath: profile.workPath ?? channel?.workPath ?? undefined,
            streamVerbose: profile.streamVerbose ?? channel?.streamVerbose ?? undefined,
            autoApproveAllTools: profile.autoApproveAllTools ?? channel?.autoApproveAllTools ?? undefined,
            approvalTimeout: profile.approvalTimeout ?? channel?.approvalTimeout ?? undefined,
            approvalTimeoutValue: profile.approvalTimeoutValue ?? channel?.approvalTimeoutValue ?? undefined,
            askTimeout: profile.askTimeout ?? channel?.askTimeout ?? undefined,
            askTimeoutMessage: profile.askTimeoutMessage ?? channel?.askTimeoutMessage ?? undefined,
            intentModel: profile.intentModel ?? channel?.intentModel ?? undefined,
            intentPrompt: profile.intentPrompt ?? channel?.intentPrompt ?? undefined,
            intentThreshold: profile.intentThreshold ?? channel?.intentThreshold ?? undefined,
        };

        return { session, profile, resolved };
    }

    // ── ensure ───────────────────────────────────────────────────────────────

    /**
     * 确保 (channelId, sessionId) 对应的 ChannelSession 存在并关联 auto profile。
     * 三类调用入口：channel plugin doInitSession / admin 建 web session / ws 收消息时 ensure。
     */
    async ensureSession(
        channelId: string,
        sessionId: string,
        opts?: {
            sessionName?: string;
            autoSessionName?: string | null;
            sessionAvatar?: string;
        },
    ): Promise<{ session: ChannelSessionRow; profile: SessionProfileRow; created: boolean }> {
        const now = Date.now();
        const sessionData: Record<string, any> = {};
        if (opts?.autoSessionName != null) sessionData.autoSessionName = opts.autoSessionName;
        if (opts?.sessionAvatar !== undefined) sessionData.avatar = opts.sessionAvatar;

        const [session, sessionCreated] = await database.findOrCreate<ChannelSessionRow>(database.channelSession, {
            where: { channelId, sessionId },
            defaults: { ...sessionData, sessionName: opts?.sessionName ?? "", profileId: 0, createdAt: now },
        });

        if (!sessionCreated) {
            // 已存在 session：仅更新与传入 sessionData 不同的字段（避免无谓写）
            const changed: Record<string, any> = {};
            for (const k of Object.keys(sessionData)) {
                if (session[k as keyof ChannelSessionRow] !== sessionData[k]) changed[k] = sessionData[k];
            }
            if (Object.keys(changed).length > 0) {
                await database.update(database.channelSession, changed, { where: { channelId, sessionId } });
                Object.assign(session, changed);
            }
        }

        let profile = await this.getProfile(session.profileId);
        if (!profile) {
            profile = await database.create<SessionProfileRow>(database.sessionProfile, {
                name: "",
                autoForSessionId: session.id,
                createdAt: now,
            });
            await database.update(database.channelSession, { profileId: profile.id }, { where: { id: session.id } });
            session.profileId = profile.id;
        }

        return { session, profile, created: sessionCreated };
    }

    // ── channel_session CRUD ─────────────────────────────────────────────────

    async listSessions(channelId?: string): Promise<ChannelSessionRow[]> {
        const where = channelId ? { channelId } : undefined;
        return database.findAll<ChannelSessionRow>(database.channelSession, { where });
    }

    /** 仅允许改 sessionName / avatar / profileId（其他配置写 profile，由 updateProfile 负责） */
    async updateSession(id: number, patch: { sessionName?: string; avatar?: string; profileId?: number }): Promise<void> {
        const update: Record<string, any> = {};
        if (patch.sessionName !== undefined) update.sessionName = patch.sessionName;
        if (patch.avatar !== undefined) update.avatar = patch.avatar;
        if (patch.profileId !== undefined) {
            const targetId = Number(patch.profileId);
            if (!targetId || targetId <= 0) throw new Error("Invalid profileId");
            const target = await this.getProfile(targetId);
            if (!target) throw new Error(`Profile id=${targetId} not found`);
            if (target.autoForSessionId != null && target.autoForSessionId !== id) {
                throw new Error(`Profile id=${targetId} is auto profile of another session`);
            }
            update.profileId = targetId;
        }
        if (Object.keys(update).length === 0) return;
        await database.update(database.channelSession, update, { where: { id } });
    }

    /**
     * 删 session 级联：
     * - 该 session 的 auto profile（visible profile 共享，不动）
     * - 上述 auto profile 名下的 scheduler（schedulerService.cascadeDeleteByProfile）
     * - heartbeat where target = sessionId
     * - heartbeat 服务 reload
     */
    async deleteSession(id: number): Promise<void> {
        const auto = await database.findOne<SessionProfileRow>(database.sessionProfile, { where: { autoForSessionId: id } });
        if (auto) await schedulerService.cascadeDeleteByProfile(auto.id);
        await database.destroy(database.sessionProfile, { where: { autoForSessionId: id } });
        await database.destroy(database.heartbeat, { where: { target: id } });
        await database.destroy(database.channelSession, { where: { id } });
        await heartbeatService.reloadAll();
    }

    // ── visible profile CRUD ─────────────────────────────────────────────────

    /** 列出所有 visible profile（autoForSessionId == null），并附 sessionCount */
    async listVisibleProfiles(): Promise<Array<SessionProfileRow & { sessionCount: number }>> {
        const profiles = await database.findAll<SessionProfileRow>(database.sessionProfile, { where: { autoForSessionId: null } });
        return Promise.all(profiles.map(async p => {
            const sessionCount = await database.count(database.channelSession, { where: { profileId: p.id } });
            return { ...p, sessionCount };
        }));
    }

    /** 单个 visible profile + 引用它的 sessions */
    async getVisibleProfileWithSessions(id: number): Promise<(SessionProfileRow & { sessions: ChannelSessionRow[] }) | null> {
        const profile = await this.getProfile(id);
        if (!profile) return null;
        const sessions = await database.findAll<ChannelSessionRow>(database.channelSession, { where: { profileId: id } });
        return { ...profile, sessions };
    }

    async createVisibleProfile(name: string): Promise<SessionProfileRow> {
        return database.create<SessionProfileRow>(database.sessionProfile, {
            name: String(name),
            autoForSessionId: null,
            createdAt: Date.now(),
        });
    }

    /**
     * 更新 profile 字段。memories/wikis 调用方传 string[] | null，本方法负责 JSON 序列化。
     * undefined = 不动；null = 清空；值 = 写入。
     */
    async updateProfile(id: number, body: Record<string, any>): Promise<void> {
        const memSer = body.memories === undefined ? undefined : (body.memories === null ? null : JSON.stringify(body.memories || []));
        const wikiSer = body.wikis === undefined ? undefined : (body.wikis === null ? null : JSON.stringify(body.wikis || []));
        const update = pickDefined({
            name: body.name,
            agentId: body.agentId === undefined ? undefined : (body.agentId || null),
            saver: body.saver === undefined ? undefined : (body.saver || null),
            memories: memSer,
            wikis: wikiSer,
            useChannelMemories: body.useChannelMemories === undefined ? undefined : (body.useChannelMemories === null ? null : !!body.useChannelMemories),
            useChannelWikis: body.useChannelWikis === undefined ? undefined : (body.useChannelWikis === null ? null : !!body.useChannelWikis),
            workPath: body.workPath === undefined ? undefined : (body.workPath || null),
            streamVerbose: body.streamVerbose === undefined ? undefined : (body.streamVerbose ?? null),
            autoApproveAllTools: body.autoApproveAllTools === undefined ? undefined : (body.autoApproveAllTools ?? null),
            approvalTimeout: body.approvalTimeout === undefined ? undefined : (body.approvalTimeout ?? null),
            approvalTimeoutValue: body.approvalTimeoutValue === undefined ? undefined : (body.approvalTimeoutValue ?? null),
            askTimeout: body.askTimeout === undefined ? undefined : (body.askTimeout ?? null),
            askTimeoutMessage: body.askTimeoutMessage === undefined ? undefined : (body.askTimeoutMessage || null),
            intentModel: body.intentModel === undefined ? undefined : (body.intentModel ?? null),
            intentPrompt: body.intentPrompt === undefined ? undefined : (body.intentPrompt || null),
            intentThreshold: body.intentThreshold === undefined ? undefined : (body.intentThreshold ?? null),
        });
        if (Object.keys(update).length === 0) return;
        await database.update(database.sessionProfile, update, { where: { id } });
    }

    /** 仅删 visible profile，校验：非 auto + 无 session 引用；级联 scheduler */
    async deleteVisibleProfile(id: number): Promise<void> {
        const profile = await this.getProfile(id);
        if (!profile) throw new Error(`Profile id=${id} not found`);
        if (profile.autoForSessionId != null) throw new Error("Cannot delete an auto profile directly");
        const refCount = await database.count(database.channelSession, { where: { profileId: id } });
        if (refCount > 0) throw new Error(`Profile id=${id} is still referenced by ${refCount} session(s)`);
        await schedulerService.cascadeDeleteByProfile(id);
        await database.destroy(database.sessionProfile, { where: { id } });
    }

    // ── profile/session 切换 ─────────────────────────────────────────────────

    /** 把当前 profile 配置复制成新 visible profile，session.profileId 切到新的；原 auto profile 保留 */
    async cloneProfileForSession(sessionId: number, name?: string): Promise<{ profileId: number }> {
        const session = await this.getSession(sessionId, true);
        const current = await this.getProfile(session!.profileId);
        const profileName = (name && name.trim()) || `${session!.sessionName || session!.sessionId}-profile`;
        const created = await database.create<SessionProfileRow>(database.sessionProfile, {
            name: profileName,
            autoForSessionId: null,
            agentId: current?.agentId ?? null,
            saver: current?.saver ?? null,
            memories: current?.memories ?? null,
            wikis: current?.wikis ?? null,
            useChannelMemories: current?.useChannelMemories ?? null,
            useChannelWikis: current?.useChannelWikis ?? null,
            workPath: current?.workPath ?? null,
            streamVerbose: current?.streamVerbose ?? null,
            autoApproveAllTools: current?.autoApproveAllTools ?? null,
            approvalTimeout: current?.approvalTimeout ?? null,
            approvalTimeoutValue: current?.approvalTimeoutValue ?? null,
            askTimeout: current?.askTimeout ?? null,
            askTimeoutMessage: current?.askTimeoutMessage ?? null,
            intentModel: current?.intentModel ?? null,
            intentPrompt: current?.intentPrompt ?? null,
            intentThreshold: current?.intentThreshold ?? null,
            createdAt: Date.now(),
        });
        await database.update(database.channelSession, { profileId: created.id }, { where: { id: sessionId } });
        return { profileId: created.id };
    }

    /** 切回独立：session.profileId 指回 session 自己的 auto profile（不存在则补建） */
    async detachToAutoProfile(sessionId: number): Promise<{ profileId: number }> {
        const session = await this.getSession(sessionId, true);
        let auto = await database.findOne<SessionProfileRow>(database.sessionProfile, { where: { autoForSessionId: sessionId } });
        if (!auto) {
            auto = await database.create<SessionProfileRow>(database.sessionProfile, {
                name: "",
                autoForSessionId: sessionId,
                createdAt: Date.now(),
            });
        }
        await database.update(database.channelSession, { profileId: auto.id }, { where: { id: session!.id } });
        return { profileId: auto.id };
    }

    // ── channel CRUD ─────────────────────────────────────────────────────────

    /**
     * 删 channel 级联：
     * - 这些 session 的 auto profile + 名下 scheduler（visible profile 共享不动）
     * - heartbeat where target ∈ sessionIds
     * - channel_session / channel_user 行
     * - heartbeat 服务 reload（channelManager.reloadChannel 由 routes 层在 settingsCrud 流程里完成）
     */
    async deleteChannel(channelId: string): Promise<void> {
        const sessions = await database.findAll<ChannelSessionRow>(database.channelSession, { where: { channelId } });
        const sessionIds = sessions.map(s => s.id);
        if (sessionIds.length > 0) {
            await database.destroy(database.heartbeat, { where: { target: sessionIds } });
            const autoProfiles = await database.findAll<SessionProfileRow>(database.sessionProfile, { where: { autoForSessionId: sessionIds } });
            for (const p of autoProfiles) await schedulerService.cascadeDeleteByProfile(p.id);
            await database.destroy(database.sessionProfile, { where: { autoForSessionId: sessionIds } });
        }
        await database.destroy(database.channelSession, { where: { channelId } });
        await database.destroy(database.channelUser, { where: { channelId } });
        await heartbeatService.reloadAll();
    }

    // ── channel_user CRUD ────────────────────────────────────────────────────

    async listChannelUsers(channelId?: string): Promise<ChannelUserRow[]> {
        const where = channelId ? { channelId } : undefined;
        return database.findAll<ChannelUserRow>(database.channelUser, { where });
    }

    async deleteChannelUser(id: number): Promise<void> {
        await database.destroy(database.channelUser, { where: { id } });
    }

    // ── web session（admin 内置 web channel 的简化入口）─────────────────────

    /** 从 visible profile id 反查它在 web channel 上的 session 行 */
    async getWebSessionByProfileId(profileId: string | number, webChannelId: string): Promise<ChannelSessionRow | null> {
        const pid = Number(profileId);
        if (!Number.isInteger(pid) || pid <= 0) return null;
        return database.findOne<ChannelSessionRow>(database.channelSession, {
            where: { channelId: webChannelId, profileId: pid },
        });
    }

    /** admin 新建 web session：ensure + 立即写一组初始 profile 字段 */
    async createWebSession(webChannelId: string, sessionId: string, body: Record<string, any>): Promise<{ session: ChannelSessionRow; profile: SessionProfileRow }> {
        const { session, profile } = await this.ensureSession(webChannelId, sessionId, {
            sessionName: body.name ?? "",
        });
        await database.update(database.sessionProfile, {
            agentId: body.agent || null,
            saver: body.saver || null,
            memories: body.memories ? JSON.stringify(body.memories) : null,
            wikis: body.wikis ? JSON.stringify(body.wikis) : null,
            workPath: body.workPath ?? null,
        }, { where: { id: profile.id } });
        return { session, profile };
    }

    /** admin 改 web session：name 写 session，其他字段写 profile */
    async updateWebSession(existing: ChannelSessionRow, body: Record<string, any>): Promise<{ profileId: number }> {
        if (body.name !== undefined) {
            await database.update(database.channelSession, { sessionName: body.name }, { where: { id: existing.id } });
        }
        const profile = await this.getProfile(existing.profileId);
        if (!profile) throw new Error(`Session "${existing.id}" has no associated profile`);
        const profileUpdate: Record<string, any> = {};
        if (body.agent !== undefined) profileUpdate.agentId = body.agent || null;
        if (body.saver !== undefined) profileUpdate.saver = body.saver || null;
        if (body.memories !== undefined) profileUpdate.memories = body.memories ? JSON.stringify(body.memories) : null;
        if (body.wikis !== undefined) profileUpdate.wikis = body.wikis ? JSON.stringify(body.wikis) : null;
        if (body.workPath !== undefined) profileUpdate.workPath = body.workPath;
        if (body.autoApproveAllTools !== undefined) profileUpdate.autoApproveAllTools = !!body.autoApproveAllTools;
        if (Object.keys(profileUpdate).length > 0) {
            await database.update(database.sessionProfile, profileUpdate, { where: { id: profile.id } });
        }
        return { profileId: profile.id };
    }
}

export const channelDataService = new ChannelDataService();
