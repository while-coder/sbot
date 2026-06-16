import {
    agendaServicePool,
    type AgendaServiceConfigResolver,
    type AgendaToolDescs,
    AgendaExtractor,
    IAgendaExtractor,
    IModelService,
    ServiceContainer,
    ILoggerService,
    T_AgendaExtractorSystemPrompt,
} from "scorpio.ai";
import { config } from "../Core/Config";
import { LoggerService } from "../Core/LoggerService";
import { loadPrompt } from "../Core/PromptLoader";
import { agendaStorePool } from "./AgendaStorePool";
import { agendaTriggerEnginePool } from "./AgendaTriggerEnginePool";

const DEFAULT_SYNC_PROMPT = "agenda/sync/default.txt";

const sharedToolDescs: AgendaToolDescs = {
    create: loadPrompt('agenda/tools/create.txt'),
    list: loadPrompt('agenda/tools/list.txt'),
    update: loadPrompt('agenda/tools/update.txt'),
    complete: loadPrompt('agenda/tools/complete.txt'),
    cancel: loadPrompt('agenda/tools/cancel.txt'),
};

/**
 * sbot 侧 AgendaServicePool 适配层。
 *
 * Pool 单例已在 scorpio.ai 内创建，这里只负责注入 sbot 特有的解析逻辑：
 *   agendaId → AgendaServiceConfig（profile / store / trigger engine / extractor）。
 *
 * tool 描述加载一次（模块加载时）共享给所有 agendaId；syncModel + syncPrompt 按需 resolve。
 */
const resolveConfig: AgendaServiceConfigResolver = (agendaId) => {
    const profile = config.getAgendaProfile(agendaId);
    if (!profile?.enabled) return null;

    const agendaStore = agendaStorePool.get(agendaId);
    const triggerEngine = agendaTriggerEnginePool.get(agendaId);

    let extractor: IAgendaExtractor | undefined;
    if (profile.syncModel) {
        const extractorModel = config.getModelService(profile.syncModel, true);
        if (!extractorModel) {
            throw new Error(`AgendaProfile "${agendaId}" syncModel "${profile.syncModel}" cannot be resolved`);
        }
        const sub = new ServiceContainer();
        sub.registerInstance(ILoggerService, { getLogger: (name: string) => LoggerService.getLogger(name) });
        sub.registerInstance(IModelService, extractorModel);
        sub.registerInstance(T_AgendaExtractorSystemPrompt, loadPrompt(profile.syncPromptFile ?? DEFAULT_SYNC_PROMPT));
        sub.registerSingleton(IAgendaExtractor, AgendaExtractor);
        extractor = sub.resolve<IAgendaExtractor>(IAgendaExtractor);
    }

    return {
        agendaStore,
        triggerEngine,
        toolDescs: sharedToolDescs,
        extractor,
    };
};

agendaServicePool.setResolver(resolveConfig);
agendaServicePool.setLoggerService({ getLogger: (name: string) => LoggerService.getLogger(name) });

const logger = LoggerService.getLogger("Agenda/AgendaServicePool.ts");

/**
 * 启动时对所有已启用的 agendaProfile 触发一次 forceExtract，消化上次进程残留的
 * pending 抽取队列。无 syncModel 的 profile 在 service 内会直接 noop，安全幂等。
 * forceExtract 内部 drain 自固定 refCount，立即返回，后台串行跑 LLM。
 */
export function startupExtractAll(): void {
    const profiles = config.settings.agendaProfiles ?? {};
    let triggered = 0;
    for (const [id, profile] of Object.entries(profiles)) {
        if (!profile?.enabled) continue;
        try {
            if (agendaServicePool.forceExtract(id)) triggered++;
        } catch (e: any) {
            logger.warn(`Agenda startup extract [${id}] failed: ${e?.message ?? String(e)}`);
        }
    }
    if (triggered > 0) logger.info(`Agenda startup extract triggered for ${triggered} profile(s)`);
}

export { agendaServicePool };
