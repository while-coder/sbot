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

export { agendaServicePool };
