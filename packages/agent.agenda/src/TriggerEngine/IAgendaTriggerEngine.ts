export interface IAgendaTriggerEngine {
    reload(triggerId: number): Promise<void>;
    reloadItem(itemId: number): Promise<void>;
    cancel(triggerId: number): void;
}

export const IAgendaTriggerEngine = Symbol("IAgendaTriggerEngine");
