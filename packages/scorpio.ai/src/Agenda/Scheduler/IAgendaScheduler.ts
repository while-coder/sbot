export interface IAgendaScheduler {
    reload(triggerId: number): Promise<void>;
    reloadItem(itemId: number): Promise<void>;
    cancel(triggerId: number): void;
}

export const IAgendaScheduler = Symbol("IAgendaScheduler");
