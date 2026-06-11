import { ApprovalTimeoutValue } from "sbot.commons";
import {
    database,
    parseNotes,
    type ChannelSessionRow,
    type SessionProfileRow,
    type ChannelUserRow,
    type HeartbeatRow,
} from "../Core/Database";
import { config } from "../Core/Config";
import { LoggerService } from "../Core/LoggerService";
import { heartbeatService } from "../Heartbeat/HeartbeatService";

const logger = LoggerService.getLogger("ChannelDataService.ts");

// ── Effective session 类型 ────────────────────────────────────────────────────

/** profile.field ?? channel.field 合并后的最终配置 */
export interface EffectiveSessionResolved {
    agentId: string;
    saver: string;
    threadKey: string;
    notes: string[];
    wikis: string[];
    workPath?: string;
    streamVerbose?: boolean;
    autoApproveAllTools?: boolean;
    disableWorkspaceContext?: boolean;
    disableWorkspaceSkills?: boolean;
    approvalTimeout?: number;
    approvalTimeoutValue?: ApprovalTimeoutValue;
    askTimeout?: number;
    askTimeoutMessage?: string;
    intentModel?: string;
    intentPrompt?: string;
    intentThreshold?: number;
    /** 经验洞察模板 UUID（resolve 后的引用），未启用时为 null */
    insight: string | null;
    /** Agenda 模板 UUID（resolve 后的引用），未启用时为 null */
    agenda: string | null;
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

/** 把 admin 提交的 ref 规范成 string|null：空串/null 都视为 null（清空覆盖） */
function normalizeRef(value: any): string | null {
    if (value == null) return null;
    const s = String(value).trim();
    return s ? s : null;
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
 * - heartbeatService.reloadAll —— heartbeat 自治
 * - channelManager.reloadChannel —— channel 运行时自治（在 routes 层调用，避开循环）
 * 注：agenda/insight 数据按 agendaId/insightId 共享，由 settings 顶层管理；
 * profile 删除时不再级联清。
 */
export class ChannelDataService {
    // 注：agenda/insight 数据现在按 agendaId/insightId 共享，不再随 profile 删除而清。
    // 数据生命周期由 /api/agenda-profiles、/api/insight-profiles 的 DELETE 路由管理。

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

        const useChannelNotes = profile.notes != null ? !!profile.useChannelNotes : false;
        const useChannelWikis = profile.wikis != null ? !!profile.useChannelWikis : false;
        const ownNotes = profile.notes != null ? parseNotes(profile.notes) : [];
        const ownWikis = profile.wikis != null ? parseNotes(profile.wikis) : [];

        const resolved: EffectiveSessionResolved = {
            agentId: profile.agentId ?? channel?.agent ?? "",
            saver: profile.saver ?? channel?.saver ?? "",
            threadKey: String(profile.id),
            notes: useChannelNotes ? [...(channel?.notes ?? []), ...ownNotes] : ownNotes,
            wikis: useChannelWikis ? [...(channel?.wikis ?? []), ...ownWikis] : ownWikis,
            workPath: profile.workPath ?? channel?.workPath ?? undefined,
            streamVerbose: profile.streamVerbose ?? channel?.streamVerbose ?? undefined,
            autoApproveAllTools: profile.autoApproveAllTools ?? channel?.autoApproveAllTools ?? undefined,
            disableWorkspaceContext: profile.disableWorkspaceContext ?? channel?.disableWorkspaceContext ?? undefined,
            disableWorkspaceSkills: profile.disableWorkspaceSkills ?? channel?.disableWorkspaceSkills ?? undefined,
            approvalTimeout: profile.approvalTimeout ?? channel?.approvalTimeout ?? undefined,
            approvalTimeoutValue: profile.approvalTimeoutValue ?? channel?.approvalTimeoutValue ?? undefined,
            askTimeout: profile.askTimeout ?? channel?.askTimeout ?? undefined,
            askTimeoutMessage: profile.askTimeoutMessage ?? channel?.askTimeoutMessage ?? undefined,
            intentModel: profile.intentModel ?? channel?.intentModel ?? undefined,
            intentPrompt: profile.intentPrompt ?? channel?.intentPrompt ?? undefined,
            intentThreshold: profile.intentThreshold ?? channel?.intentThreshold ?? undefined,
            insight: profile.insight ?? channel?.insight ?? null,
            agenda: profile.agenda ?? channel?.agenda ?? null,
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

    /**
     * 列出 sessions，并把 session.profileId 指向的 profile 字段（含 token 统计）
     * 平铺到每条记录上 —— admin UI 显示需要 agentId/saver/notes/tokens 等，
     * 这些都是 profile 字段。notes/wikis 解析后返回 string[] | null。
     *
     * Profile 字段值的语义：null = 沿用 channel 默认；非 null = profile 已覆盖。
     */
    async listSessions(channelId?: string): Promise<ChannelSessionWithProfile[]> {
        const where = channelId ? { channelId } : undefined;
        const sessions = await database.findAll<ChannelSessionRow>(database.channelSession, { where });
        if (sessions.length === 0) return [];
        const profileIds = [...new Set(sessions.map(s => s.profileId))];
        const profiles = await database.findAll<SessionProfileRow>(database.sessionProfile, {
            where: { id: profileIds },
        });
        const profileMap = new Map(profiles.map(p => [p.id, p]));
        return sessions.map(s => {
            const p = profileMap.get(s.profileId);
            return {
                ...s,
                agentId: p?.agentId ?? null,
                saver: p?.saver ?? null,
                notes: p?.notes != null ? parseNotes(p.notes) : null,
                wikis: p?.wikis != null ? parseNotes(p.wikis) : null,
                useChannelNotes: p?.useChannelNotes ?? null,
                useChannelWikis: p?.useChannelWikis ?? null,
                workPath: p?.workPath ?? null,
                streamVerbose: p?.streamVerbose ?? null,
                autoApproveAllTools: p?.autoApproveAllTools ?? null,
                disableWorkspaceContext: p?.disableWorkspaceContext ?? null,
                disableWorkspaceSkills: p?.disableWorkspaceSkills ?? null,
                approvalTimeout: p?.approvalTimeout ?? null,
                approvalTimeoutValue: p?.approvalTimeoutValue ?? null,
                askTimeout: p?.askTimeout ?? null,
                askTimeoutMessage: p?.askTimeoutMessage ?? null,
                intentModel: p?.intentModel ?? null,
                intentPrompt: p?.intentPrompt ?? null,
                intentThreshold: p?.intentThreshold ?? null,
                insight: p?.insight ?? null,
                agenda: p?.agenda ?? null,
                inputTokens: p?.inputTokens ?? 0,
                outputTokens: p?.outputTokens ?? 0,
                totalTokens: p?.totalTokens ?? 0,
                lastInputTokens: p?.lastInputTokens ?? 0,
                lastOutputTokens: p?.lastOutputTokens ?? 0,
                lastTotalTokens: p?.lastTotalTokens ?? 0,
            };
        });
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
     * - heartbeat where target = sessionId
     * - heartbeat 服务 reload
     * 注：profile 引用的 agenda/insight 模板数据归 admin 管理，这里不动。
     */
    async deleteSession(id: number): Promise<void> {
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
     * 更新 profile 字段。notes/wikis 调用方传 string[] | null，本方法负责 JSON 序列化。
     * undefined = 不动；null = 清空；值 = 写入。
     */
    async updateProfile(id: number, body: Record<string, any>): Promise<void> {
        const noteSer = body.notes === undefined ? undefined : (body.notes === null ? null : JSON.stringify(body.notes || []));
        const wikiSer = body.wikis === undefined ? undefined : (body.wikis === null ? null : JSON.stringify(body.wikis || []));
        const insightRef = body.insight === undefined ? undefined : normalizeRef(body.insight);
        const agendaRef = body.agenda === undefined ? undefined : normalizeRef(body.agenda);
        const update = pickDefined({
            name: body.name,
            agentId: body.agentId === undefined ? undefined : (body.agentId || null),
            saver: body.saver === undefined ? undefined : (body.saver || null),
            notes: noteSer,
            wikis: wikiSer,
            useChannelNotes: body.useChannelNotes === undefined ? undefined : (body.useChannelNotes === null ? null : !!body.useChannelNotes),
            useChannelWikis: body.useChannelWikis === undefined ? undefined : (body.useChannelWikis === null ? null : !!body.useChannelWikis),
            workPath: body.workPath === undefined ? undefined : (body.workPath || null),
            streamVerbose: body.streamVerbose === undefined ? undefined : (body.streamVerbose ?? null),
            autoApproveAllTools: body.autoApproveAllTools === undefined ? undefined : (body.autoApproveAllTools ?? null),
            disableWorkspaceContext: body.disableWorkspaceContext === undefined ? undefined : (body.disableWorkspaceContext ?? null),
            disableWorkspaceSkills: body.disableWorkspaceSkills === undefined ? undefined : (body.disableWorkspaceSkills ?? null),
            approvalTimeout: body.approvalTimeout === undefined ? undefined : (body.approvalTimeout ?? null),
            approvalTimeoutValue: body.approvalTimeoutValue === undefined ? undefined : (body.approvalTimeoutValue ?? null),
            askTimeout: body.askTimeout === undefined ? undefined : (body.askTimeout ?? null),
            askTimeoutMessage: body.askTimeoutMessage === undefined ? undefined : (body.askTimeoutMessage || null),
            intentModel: body.intentModel === undefined ? undefined : (body.intentModel ?? null),
            intentPrompt: body.intentPrompt === undefined ? undefined : (body.intentPrompt || null),
            intentThreshold: body.intentThreshold === undefined ? undefined : (body.intentThreshold ?? null),
            insight: insightRef,
            agenda: agendaRef,
        });
        if (Object.keys(update).length === 0) return;
        await database.update(database.sessionProfile, update, { where: { id } });
    }

    /** 仅删 visible profile，校验：非 auto + 无 session 引用 */
    async deleteVisibleProfile(id: number): Promise<void> {
        const profile = await this.getProfile(id);
        if (!profile) throw new Error(`Profile id=${id} not found`);
        if (profile.autoForSessionId != null) throw new Error("Cannot delete an auto profile directly");
        const refCount = await database.count(database.channelSession, { where: { profileId: id } });
        if (refCount > 0) throw new Error(`Profile id=${id} is still referenced by ${refCount} session(s)`);
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
            notes: current?.notes ?? null,
            wikis: current?.wikis ?? null,
            useChannelNotes: current?.useChannelNotes ?? null,
            useChannelWikis: current?.useChannelWikis ?? null,
            workPath: current?.workPath ?? null,
            streamVerbose: current?.streamVerbose ?? null,
            autoApproveAllTools: current?.autoApproveAllTools ?? null,
            disableWorkspaceContext: current?.disableWorkspaceContext ?? null,
            disableWorkspaceSkills: current?.disableWorkspaceSkills ?? null,
            approvalTimeout: current?.approvalTimeout ?? null,
            approvalTimeoutValue: current?.approvalTimeoutValue ?? null,
            askTimeout: current?.askTimeout ?? null,
            askTimeoutMessage: current?.askTimeoutMessage ?? null,
            intentModel: current?.intentModel ?? null,
            intentPrompt: current?.intentPrompt ?? null,
            intentThreshold: current?.intentThreshold ?? null,
            insight: current?.insight ?? null,
            agenda: current?.agenda ?? null,
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
     * - 这些 session 的 auto profile（visible profile 共享不动）
     * - heartbeat where target ∈ sessionIds
     * - channel_session / channel_user 行
     * - heartbeat 服务 reload（channelManager.reloadChannel 由 routes 层在 settingsCrud 流程里完成）
     * 注：profile 引用的 agenda/insight 模板数据归 admin 管理，这里不动。
     */
    async deleteChannel(channelId: string): Promise<void> {
        const sessions = await database.findAll<ChannelSessionRow>(database.channelSession, { where: { channelId } });
        const sessionIds = sessions.map(s => s.id);
        if (sessionIds.length > 0) {
            await database.destroy(database.heartbeat, { where: { target: sessionIds } });
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
            notes: body.notes ? JSON.stringify(body.notes) : null,
            wikis: body.wikis ? JSON.stringify(body.wikis) : null,
            workPath: body.workPath ?? null,
            disableWorkspaceContext: body.disableWorkspaceContext ?? null,
            disableWorkspaceSkills: body.disableWorkspaceSkills ?? null,
            insight: normalizeRef(body.insight),
            agenda: normalizeRef(body.agenda),
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
        if (body.notes !== undefined) profileUpdate.notes = body.notes ? JSON.stringify(body.notes) : null;
        if (body.wikis !== undefined) profileUpdate.wikis = body.wikis ? JSON.stringify(body.wikis) : null;
        if (body.workPath !== undefined) profileUpdate.workPath = body.workPath;
        if (body.autoApproveAllTools !== undefined) profileUpdate.autoApproveAllTools = !!body.autoApproveAllTools;
        if (body.disableWorkspaceContext !== undefined) profileUpdate.disableWorkspaceContext = body.disableWorkspaceContext ?? null;
        if (body.disableWorkspaceSkills !== undefined) profileUpdate.disableWorkspaceSkills = body.disableWorkspaceSkills ?? null;
        if (body.insight !== undefined) profileUpdate.insight = normalizeRef(body.insight);
        if (body.agenda !== undefined) profileUpdate.agenda = normalizeRef(body.agenda);
        if (Object.keys(profileUpdate).length > 0) {
            await database.update(database.sessionProfile, profileUpdate, { where: { id: profile.id } });
        }
        return { profileId: profile.id };
    }

    // ── cleanup orphans（手动维护工具） ──────────────────────────────────────

    /**
     * 扫描所有跨表引用孤儿，dryRun=true 只列出，dryRun=false 实际清理。
     *
     * 检查项：
     * - channel_session.channelId 不在 config.settings.channels（channel 已删除但 session 残留）
     * - channel_user.channelId 不在 config.settings.channels
     * - sessionProfile.autoForSessionId 不存在或指向已是孤儿的 session
     * - heartbeat.target 不存在
     * - visible profile（autoForSessionId=null）但无任何 session 引用 —— 仅列出，不删
     *
     * 注意：empty visible profile 仅列出。用户可能正在准备复用一个空 profile，自动删除会损失意图。
     */
    async cleanupOrphans(opts: { dryRun?: boolean } = {}): Promise<CleanupReport> {
        const dryRun = !!opts.dryRun;

        const [allSessions, allProfiles, allHeartbeats, allChannelUsers] = await Promise.all([
            database.findAll<ChannelSessionRow>(database.channelSession),
            database.findAll<SessionProfileRow>(database.sessionProfile),
            database.findAll<HeartbeatRow>(database.heartbeat),
            database.findAll<ChannelUserRow>(database.channelUser),
        ]);

        const sessionIds = new Set(allSessions.map(s => s.id));
        const configChannelIds = new Set(Object.keys(config.settings.channels || {}));
        const profileIdsWithSessions = new Set(allSessions.map(s => s.profileId));

        // 1. channel 已不在 config 的 session
        const orphanChannelSessions = allSessions.filter(s => !configChannelIds.has(s.channelId));
        const orphanChannelSessionIds = new Set(orphanChannelSessions.map(s => s.id));

        // 2. channel 已不在 config 的 user
        const orphanChannelUsers = allChannelUsers.filter(u => !configChannelIds.has(u.channelId));

        // 3. auto profile 指向不存在的 / 即将清理的 session
        const orphanAutoProfiles = allProfiles.filter(p => {
            if (p.autoForSessionId == null) return false;
            if (!sessionIds.has(p.autoForSessionId)) return true;
            return orphanChannelSessionIds.has(p.autoForSessionId);
        });

        // 4. heartbeat.target 不存在或将随孤儿 channel 清掉
        const orphanHeartbeats = allHeartbeats.filter(h =>
            !sessionIds.has(h.target) || orphanChannelSessionIds.has(h.target)
        );

        // 5. 无 session 引用的 visible profile（仅报告，不删）
        const emptyVisibleProfiles = allProfiles.filter(p =>
            p.autoForSessionId == null && !profileIdsWithSessions.has(p.id)
        );

        if (!dryRun) {
            // Step 1：失效 channel 整套清掉（顺带清这些 channel 名下的 session/user/auto profile/agenda/heartbeat）
            const orphanChannelIds = new Set<string>();
            for (const s of orphanChannelSessions) orphanChannelIds.add(s.channelId);
            for (const u of orphanChannelUsers) orphanChannelIds.add(u.channelId);
            for (const cid of orphanChannelIds) {
                await this.deleteChannel(cid);
            }

            // Step 2：剩下的孤儿 auto profile（指向从未存在的 sessionId）
            for (const p of orphanAutoProfiles) {
                if (orphanChannelSessionIds.has(p.autoForSessionId!)) continue; // 已被 Step 1 清
                const stillExists = await database.findByPk<SessionProfileRow>(database.sessionProfile, p.id);
                if (!stillExists) continue;
                await database.destroy(database.sessionProfile, { where: { id: p.id } });
            }

            // Step 3：target 失效的孤儿 heartbeat（重扫一次）
            const refreshedSessionIds = new Set(
                (await database.findAll<ChannelSessionRow>(database.channelSession)).map(s => s.id),
            );
            const remainingOrphanHeartbeatIds: number[] = [];
            for (const h of orphanHeartbeats) {
                if (!refreshedSessionIds.has(h.target)) {
                    const stillExists = await database.findByPk<HeartbeatRow>(database.heartbeat, h.id);
                    if (stillExists) remainingOrphanHeartbeatIds.push(h.id);
                }
            }
            if (remainingOrphanHeartbeatIds.length > 0) {
                await database.destroy(database.heartbeat, { where: { id: remainingOrphanHeartbeatIds } });
                await heartbeatService.reloadAll();
            }

            const counts = {
                channels: orphanChannelIds.size,
                sessions: orphanChannelSessions.length,
                users: orphanChannelUsers.length,
                autoProfiles: orphanAutoProfiles.length,
                heartbeats: remainingOrphanHeartbeatIds.length + orphanHeartbeats.length, // 近似
            };
            logger.info(`cleanupOrphans applied: channels=${counts.channels}, sessions=${counts.sessions}, users=${counts.users}, autoProfiles=${counts.autoProfiles}, heartbeats=${counts.heartbeats}`);
        }

        const invalidRefs = scanInvalidReferences(allProfiles);

        return {
            dryRun,
            orphanChannelSessions: orphanChannelSessions.map(s => ({
                id: s.id, channelId: s.channelId, sessionId: s.sessionId, sessionName: s.sessionName,
            })),
            orphanChannelUsers: orphanChannelUsers.map(u => ({
                id: u.id, channelId: u.channelId, userId: u.userId, userName: u.userName,
            })),
            orphanAutoProfiles: orphanAutoProfiles.map(p => ({
                id: p.id, autoForSessionId: p.autoForSessionId!, name: p.name,
            })),
            orphanHeartbeats: orphanHeartbeats.map(h => ({
                id: h.id, target: h.target, name: h.name,
            })),
            emptyVisibleProfiles: emptyVisibleProfiles.map(p => ({
                id: p.id, name: p.name,
            })),
            ...invalidRefs,
        };
    }
}

// ── 无效引用扫描 ───────────────────────────────────────────────────────────────

/**
 * 扫描配置 + DB profile 的字段引用，找出指向不存在目标的引用。
 *
 * 覆盖：
 * - agent ID（profile.agentId / channel.agent / agent.agents[].id）
 * - saver UUID（profile.saver / channel.saver）
 * - model UUID（intentModel / agent.model / agent.compactModel / insightProfile.extractor / agendaProfile.syncModel）
 * - embedding UUID（note.embedding / wiki.embedding）
 * - note/wiki UUID（profile.notes[] / channel.notes[]，wikis 同理）
 * - insightProfile / agendaProfile UUID（profile.insight / channel.insight，agenda 同理）
 */
function scanInvalidReferences(allProfiles: SessionProfileRow[]): {
    invalidAgentRefs: InvalidRef[];
    invalidSaverRefs: InvalidRef[];
    invalidModelRefs: InvalidRef[];
    invalidEmbeddingRefs: InvalidRef[];
    invalidNoteRefs: InvalidRef[];
    invalidWikiRefs: InvalidRef[];
    invalidInsightProfileRefs: InvalidRef[];
    invalidAgendaProfileRefs: InvalidRef[];
} {
    const settings = config.settings;
    const channels = settings.channels ?? {};
    const models = settings.models ?? {};
    const embeddings = settings.embeddings ?? {};
    const savers = settings.savers ?? {};
    const notes = settings.notes ?? {};
    const wikis = settings.wikis ?? {};
    const insightProfiles = settings.insightProfiles ?? {};
    const agendaProfiles = settings.agendaProfiles ?? {};
    const agentIds = new Set(config.listAgents().map(a => a.id));

    const has = (map: Record<string, unknown>, id: string | null | undefined): boolean =>
        !!id && Object.prototype.hasOwnProperty.call(map, id);

    const invalidAgentRefs: InvalidRef[] = [];
    const invalidSaverRefs: InvalidRef[] = [];
    const invalidModelRefs: InvalidRef[] = [];
    const invalidEmbeddingRefs: InvalidRef[] = [];
    const invalidNoteRefs: InvalidRef[] = [];
    const invalidWikiRefs: InvalidRef[] = [];
    const invalidInsightProfileRefs: InvalidRef[] = [];
    const invalidAgendaProfileRefs: InvalidRef[] = [];

    const profileSource = (p: SessionProfileRow): string => {
        if (p.autoForSessionId != null) return `profile:#${p.id}(auto for session#${p.autoForSessionId})`;
        return `profile:#${p.id}${p.name ? `(${p.name})` : ''}`;
    };

    // ── profiles ─────────────────────────────────────────────────────────
    for (const p of allProfiles) {
        const src = profileSource(p);
        if (p.agentId && !agentIds.has(p.agentId)) invalidAgentRefs.push({ source: src, field: 'agentId', badValue: p.agentId });
        if (p.saver && !has(savers, p.saver)) invalidSaverRefs.push({ source: src, field: 'saver', badValue: p.saver });
        if (p.intentModel && !has(models, p.intentModel)) invalidModelRefs.push({ source: src, field: 'intentModel', badValue: p.intentModel });
        if (p.insight && !has(insightProfiles, p.insight)) invalidInsightProfileRefs.push({ source: src, field: 'insight', badValue: p.insight });
        if (p.agenda && !has(agendaProfiles, p.agenda)) invalidAgendaProfileRefs.push({ source: src, field: 'agenda', badValue: p.agenda });

        const noteIds = parseNotes(p.notes);
        noteIds.forEach((id, i) => {
            if (!has(notes, id)) invalidNoteRefs.push({ source: src, field: `notes[${i}]`, badValue: id });
        });
        const wikiIds = parseNotes(p.wikis);
        wikiIds.forEach((id, i) => {
            if (!has(wikis, id)) invalidWikiRefs.push({ source: src, field: `wikis[${i}]`, badValue: id });
        });
    }

    // ── channels ─────────────────────────────────────────────────────────
    for (const [cid, c] of Object.entries(channels)) {
        const src = `channel:${cid}${c.name ? `(${c.name})` : ''}`;
        if (c.agent && !agentIds.has(c.agent)) invalidAgentRefs.push({ source: src, field: 'agent', badValue: c.agent });
        if (c.saver && !has(savers, c.saver)) invalidSaverRefs.push({ source: src, field: 'saver', badValue: c.saver });
        if (c.intentModel && !has(models, c.intentModel)) invalidModelRefs.push({ source: src, field: 'intentModel', badValue: c.intentModel });
        if (c.insight && !has(insightProfiles, c.insight)) invalidInsightProfileRefs.push({ source: src, field: 'insight', badValue: c.insight });
        if (c.agenda && !has(agendaProfiles, c.agenda)) invalidAgendaProfileRefs.push({ source: src, field: 'agenda', badValue: c.agenda });
        (c.notes ?? []).forEach((id, i) => {
            if (!has(notes, id)) invalidNoteRefs.push({ source: src, field: `notes[${i}]`, badValue: id });
        });
        (c.wikis ?? []).forEach((id, i) => {
            if (!has(wikis, id)) invalidWikiRefs.push({ source: src, field: `wikis[${i}]`, badValue: id });
        });
    }

    // ── notes / wikis 引用 embedding ─────────────────────────────────────
    for (const [nid, n] of Object.entries(notes)) {
        if (n.embedding && !has(embeddings, n.embedding)) {
            invalidEmbeddingRefs.push({ source: `note:${nid}${n.name ? `(${n.name})` : ''}`, field: 'embedding', badValue: n.embedding });
        }
    }
    for (const [wid, w] of Object.entries(wikis)) {
        if (w.embedding && !has(embeddings, w.embedding)) {
            invalidEmbeddingRefs.push({ source: `wiki:${wid}${w.name ? `(${w.name})` : ''}`, field: 'embedding', badValue: w.embedding });
        }
    }

    // ── insightProfiles / agendaProfiles 引用 model ──────────────────────
    for (const [iid, ip] of Object.entries(insightProfiles)) {
        if (ip.extractor && !has(models, ip.extractor)) {
            invalidModelRefs.push({ source: `insightProfile:${iid}${ip.name ? `(${ip.name})` : ''}`, field: 'extractor', badValue: ip.extractor });
        }
    }
    for (const [aid, ap] of Object.entries(agendaProfiles)) {
        if (ap.syncModel && !has(models, ap.syncModel)) {
            invalidModelRefs.push({ source: `agendaProfile:${aid}${ap.name ? `(${ap.name})` : ''}`, field: 'syncModel', badValue: ap.syncModel });
        }
    }

    // ── agents 引用 model / 子 agent ─────────────────────────────────────
    for (const a of config.listAgents()) {
        const src = `agent:${a.id}${(a as any).name ? `((${(a as any).name}))` : ''}`;
        const am = a as any;
        if (am.model && !has(models, am.model)) invalidModelRefs.push({ source: src, field: 'model', badValue: am.model });
        if (am.compactModel && !has(models, am.compactModel)) invalidModelRefs.push({ source: src, field: 'compactModel', badValue: am.compactModel });
        const subs: Array<{ id: string }> = Array.isArray(am.agents) ? am.agents : [];
        subs.forEach((sub, i) => {
            if (sub?.id && !agentIds.has(sub.id)) invalidAgentRefs.push({ source: src, field: `agents[${i}].id`, badValue: sub.id });
        });
    }

    return {
        invalidAgentRefs,
        invalidSaverRefs,
        invalidModelRefs,
        invalidEmbeddingRefs,
        invalidNoteRefs,
        invalidWikiRefs,
        invalidInsightProfileRefs,
        invalidAgendaProfileRefs,
    };
}

// ── listSessions 响应类型 ─────────────────────────────────────────────────────

/**
 * channel_session 行 + 它指向的 profile 字段（admin UI 需要展示 agent/saver/notes/tokens 等）。
 * profile 字段：null = 沿用 channel 默认；非 null = profile 已覆盖。
 * notes/wikis 已从 JSON 字符串解析为 string[]，null = 未覆盖。
 */
export interface ChannelSessionWithProfile extends ChannelSessionRow {
    agentId: string | null;
    saver: string | null;
    notes: string[] | null;
    wikis: string[] | null;
    useChannelNotes: boolean | null;
    useChannelWikis: boolean | null;
    workPath: string | null;
    streamVerbose: boolean | null;
    autoApproveAllTools: boolean | null;
    disableWorkspaceContext: boolean | null;
    disableWorkspaceSkills: boolean | null;
    approvalTimeout: number | null;
    approvalTimeoutValue: ApprovalTimeoutValue | null;
    askTimeout: number | null;
    askTimeoutMessage: string | null;
    intentModel: string | null;
    intentPrompt: string | null;
    intentThreshold: number | null;
    insight: string | null;
    agenda: string | null;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    lastInputTokens: number;
    lastOutputTokens: number;
    lastTotalTokens: number;
}

// ── cleanup / scan report ─────────────────────────────────────────────────────

/** 一条无效引用：source 是引用方，field 是哪个字段，badValue 是不存在的目标 ID */
export interface InvalidRef {
    source: string;
    field: string;
    badValue: string;
}

export interface CleanupReport {
    dryRun: boolean;
    /** 跨表残留行（cleanupOrphans 自动清理） */
    orphanChannelSessions: Array<{ id: number; channelId: string; sessionId: string; sessionName: string }>;
    orphanChannelUsers: Array<{ id: number; channelId: string; userId: string; userName: string }>;
    orphanAutoProfiles: Array<{ id: number; autoForSessionId: number; name: string }>;
    orphanHeartbeats: Array<{ id: number; target: number; name: string }>;
    /** 仅列出，cleanupOrphans 不会删；用户决定是否手删 */
    emptyVisibleProfiles: Array<{ id: number; name: string }>;
    /** 配置间引用对方但目标已不存在（仅列出，需用户手动改） */
    invalidAgentRefs: InvalidRef[];
    invalidSaverRefs: InvalidRef[];
    invalidModelRefs: InvalidRef[];
    invalidEmbeddingRefs: InvalidRef[];
    invalidNoteRefs: InvalidRef[];
    invalidWikiRefs: InvalidRef[];
    invalidInsightProfileRefs: InvalidRef[];
    invalidAgendaProfileRefs: InvalidRef[];
}

export const channelDataService = new ChannelDataService();
