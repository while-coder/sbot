import type { ChatMessage } from "../../Saver";
import type {
    AgendaCreateArgs,
    AgendaEditArgs,
    AgendaRecord,
} from "../types";

/**
 * sync extractor 能产出的动作种类。与 LLM 侧工具面刻意保持一致（create / edit），
 * 这样 sync prompt 与 tool prompt 描述的是同一套语义，不需要两份心智模型。
 *
 * 没有 close/complete：sync 是**静默**的后台抽取，终结一条 agenda 属于用户可感知的破坏性变更，
 * 必须由主 agent 显式调 agenda_close（sync prompt 里也明确禁止）。
 */
export enum AgendaActionType {
    Create = 'create',
    /** 主体字段 + trigger 增删改，语义与载荷同 agenda_edit。 */
    Edit = 'edit',
}

export type AgendaAction =
    | { type: AgendaActionType.Create; args: AgendaCreateArgs }
    | ({ type: AgendaActionType.Edit; id: number } & AgendaEditArgs);

export interface IAgendaExtractor {
    extract(messages: ChatMessage[], existingItems: AgendaRecord[]): Promise<AgendaAction[]>;
}

export const IAgendaExtractor = Symbol("IAgendaExtractor");
