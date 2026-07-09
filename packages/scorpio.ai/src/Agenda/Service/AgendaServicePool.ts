import { ServiceContainer } from "scorpio.di";
import { T_AgendaToolDescs } from "../../Core";
import { ILogger, ILoggerService } from "../../Logger";
import { truncateForLog } from "../../Utils/contentUtils";
import { DEFAULT_PENDING_JOB_LIMIT } from "../limits";
import { IAgendaStore, type PendingAgendaJobRow } from "../Storage/IAgendaStore";
import { IAgendaTriggerEngine } from "../TriggerEngine/IAgendaTriggerEngine";
import { IAgendaExtractor } from "../Extractor/IAgendaExtractor";
import { AgendaService } from "./AgendaService";
import { IAgendaService, type AgendaToolDescs } from "./IAgendaService";

/**
 * 由 caller resolver 提供的、构造一个 AgendaService 所需的全部"已 resolved 配置"。
 * Agenda 模板 db、TriggerEngine、Extractor 这些应用层概念都由 caller 完成，pool 不参与。
 */
export interface AgendaServiceConfig {
    /** 该 agendaId 对应的存储；由 sbot 侧 agendaStorePool 共享。 */
    agendaStore: IAgendaStore;
    /** 该 agendaId 的触发引擎；由 sbot 侧 agendaTriggerEnginePool 共享。 */
    triggerEngine: IAgendaTriggerEngine;
    /** 工具描述（注入到 agenda_create / agenda_list / ... 工具的 description）。 */
    toolDescs: AgendaToolDescs;
    /** 后台抽取 LLM；可选——profile 没配 syncModel 时为空，此时抽取直接 noop。 */
    extractor?: IAgendaExtractor;
}

/**
 * 按 agendaId 解析配置。返回 null 表示 profile 不存在或被禁用。
 * 必须同步——caller 在调用前需要把 store / trigger engine / model 工厂、prompt 文件加载等都 resolve 好。
 * 解析失败（如 syncModel 拉不到）应抛错。
 */
export type AgendaServiceConfigResolver =
    (agendaId: string) => AgendaServiceConfig | null;

/**
 * 进程内 AgendaService 缓存：每个 agendaId 共享一个实例。**单例**——通过
 * `AgendaServicePool.getInstance()`（或 named export `agendaServicePool`）拿。
 *
 * **必须使用 pool**——AgendaService 的"串行抽取 + 单实例 isRunning"语义只在
 * 同 agendaId 全局唯一实例下成立。多实例并发跑 LLM 抽取会造成重复 create / 浪费 token。
 *
 * 生命周期模型（纯 refCount，无强制销毁）：
 * - acquire(id)：cache miss → build 新实例并唤醒 drain；命中实例 incRef 后返回；
 *   调用方用完后 service.release() 配对归还
 * - refCount 归零自动 evict（仅清 cache，不 dispose store —— store 由 sbot 侧 agendaStorePool 拥有）
 * - drain（checkJobs）自固定 refCount，drain 期间 caller release 不会触发 evict
 * - cache 中只可能有"还活着"的实例 —— 不开放外部 invalidate / cache.delete，
 *   保证"同 agendaId 全局唯一 live 实例"不变量
 */
export class AgendaServicePool {
    private static _instance: AgendaServicePool | null = null;

    /** 拿单例（懒构造）。 */
    static getInstance(): AgendaServicePool {
        if (!this._instance) this._instance = new AgendaServicePool();
        return this._instance;
    }

    private cache = new Map<string, AgendaService>();
    private resolveConfig?: AgendaServiceConfigResolver;
    private loggerService?: ILoggerService;
    private logger?: ILogger;

    private constructor() {}

    /** 配置 agendaId → AgendaServiceConfig 解析器；必须在第一次 acquire 之前调用。 */
    setResolver(resolver: AgendaServiceConfigResolver): void {
        this.resolveConfig = resolver;
    }

    /** 配置 logger service（可选）。 */
    setLoggerService(svc: ILoggerService): void {
        this.loggerService = svc;
        this.logger = svc.getLogger("AgendaServicePool");
    }

    /**
     * 拿一个 service 引用并 incRef。caller 用完务必调 `service.release()`。
     *
     * 流程：
     * - cache miss → 同步 build + cache.set（同步路径无 await 缝隙，保证同 agendaId 只构造一次实例）
     * - incRef 持有 caller 引用后返回
     * - 新实例首次唤醒 drain；drain 自固定 refCount，消费进程崩溃前残留的 pending jobs
     *
     * agendaId 配置错误（profile 不存在 / disabled）直接 throw —— caller 应当在调用前
     * 自行 guard。后续 acquire 不会再唤醒 drain；chat 路径靠 extractFromConversation
     * 自启 drain，admin 走 forceExtract 时自带显式 processPending。
     */
    acquire(agendaId: string): IAgendaService {
        let service: AgendaService;
        let shouldStart = false;
        const cached = this.cache.get(agendaId);
        if (cached) {
            service = cached;
        } else {
            service = this.build(agendaId);
            this.cache.set(agendaId, service);
            shouldStart = true;
        }

        service.incRef();
        if (shouldStart) service.processPending();
        return service;
    }

    /** Service 自驱逐：refCount 归零后由 service.release() 调进来。 */
    evict(service: AgendaService): void {
        for (const [id, cached] of this.cache) {
            if (cached === service) {
                this.cache.delete(id);
                this.logger?.info(`AgendaService [${id}] evicted`);
                return;
            }
        }
    }

    /** admin 触发：唤醒 pending job 队列消费（不阻塞，UI 自行轮询 listPendingJobs 看进度）。 */
    forceExtract(agendaId: string): void {
        let service: IAgendaService | undefined;
        try {
            service = this.acquire(agendaId);
            service.processPending();
        } catch (e: any) {
            this.logActionFailed('唤醒日程队列', agendaId, e);
        } finally {
            this.releaseQuietly(service, '唤醒日程队列', agendaId);
        }
    }

    listPendingJobs(agendaId: string, limit = DEFAULT_PENDING_JOB_LIMIT): PendingAgendaJobRow[] {
        const service = this.acquire(agendaId);
        try { return service.listPending(limit); }
        finally { service.release(); }
    }

    /**
     * 同步构造 service 实例（DI），不跑任何异步副作用。
     * agendaId 配置缺失（resolver 没配 / profile 不存在）直接 throw —— 这条路径属于配置错误，
     * caller 应当在调用前自行 guard，不应靠 build 返回 null 兜底。
     */
    private build(agendaId: string): AgendaService {
        if (!this.resolveConfig) throw new Error('AgendaServicePool: resolver not configured. Call setResolver() before use.');
        const cfg = this.resolveConfig(agendaId);
        if (!cfg) throw new Error(`AgendaServicePool: unknown or disabled agendaId "${agendaId}"`);

        const sub = new ServiceContainer();
        if (this.loggerService) sub.registerInstance(ILoggerService, this.loggerService);
        sub.registerInstance(T_AgendaToolDescs, cfg.toolDescs);
        sub.registerInstance(IAgendaStore, cfg.agendaStore);
        sub.registerInstance(IAgendaTriggerEngine, cfg.triggerEngine);
        if (cfg.extractor) sub.registerInstance(IAgendaExtractor, cfg.extractor);
        sub.registerSingleton(IAgendaService, AgendaService);

        const service = sub.resolve<AgendaService>(IAgendaService) as AgendaService;
        this.logger?.info(`AgendaService [${agendaId}] built`);
        return service;
    }

    private releaseQuietly(service: IAgendaService | undefined, action: string, agendaId: string): void {
        if (!service) return;
        try { service.release(); }
        catch (e: any) { this.logActionFailed(`${action} release`, agendaId, e); }
    }

    private logActionFailed(action: string, agendaId: string, e: any): void {
        const err = truncateForLog(e?.message ?? String(e));
        this.logger?.warn(`日程后台任务失败：agendaId=${agendaId}，动作=${action}，错误=${err}`);
    }
}

/** 包级单例，等同于 `AgendaServicePool.getInstance()`。 */
export const agendaServicePool = AgendaServicePool.getInstance();
