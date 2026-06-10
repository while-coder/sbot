export enum AgendaStatus {
    Pending = 'pending',
    Done = 'done',
    Cancelled = 'cancelled',
}

export enum AgendaPriority {
    Low = 'low',
    Normal = 'normal',
    High = 'high',
}

export enum AgendaCategory {
    Todo = 'todo',
    Reminder = 'reminder',
    Routine = 'routine',
    Automation = 'automation',
}

export enum AgendaCompletionMode {
    None = 'none',
    Item = 'item',
    Occurrence = 'occurrence',
}

export enum AgendaSource {
    User = 'user',
    Tool = 'tool',
    Sync = 'sync',
    Rule = 'rule',
}

export enum AgendaTriggerKind {
    Absolute = 'absolute',
    Interval = 'interval',
    Cron = 'cron',
}

export enum AgendaTriggerAction {
    Notify = 'notify',
    Send = 'send',
    Invoke = 'invoke',
}

export enum AgendaOccurrenceStatus {
    Pending = 'pending',
    Done = 'done',
    Cancelled = 'cancelled',
    Skipped = 'skipped',
}

export type AgendaTimeUnit = 'minute' | 'hour' | 'day' | 'week';

export interface AgendaRelativeTime {
    amount: number;
    unit: AgendaTimeUnit;
}

export interface AgendaCreateArgs {
    content: string;
    category?: AgendaCategory;
    priority?: AgendaPriority;
    at?: string;
    after?: AgendaRelativeTime;
    every?: AgendaRelativeTime;
    cron?: string;
    timezone?: string;
    action?: AgendaTriggerAction;
    message?: string;
    completionMode?: AgendaCompletionMode;
    source?: AgendaSource;
}

export interface AgendaUpdatePatch {
    content?: string;
    category?: AgendaCategory;
    priority?: AgendaPriority;
    completionMode?: AgendaCompletionMode;
    dueAt?: string | null;
    at?: string;
    after?: AgendaRelativeTime;
    every?: AgendaRelativeTime;
    cron?: string;
    timezone?: string | null;
    action?: AgendaTriggerAction;
    message?: string | null;
}

export interface AgendaListFilter {
    status?: AgendaStatus | 'all';
    category?: AgendaCategory;
    priority?: AgendaPriority;
    view?: 'todo' | 'upcoming' | 'routine' | 'automation' | 'all';
    limit?: number;
}

export interface AgendaItem {
    id: number;
    profileId: number;
    content: string;
    status: AgendaStatus;
    priority: AgendaPriority;
    category: AgendaCategory;
    completionMode: AgendaCompletionMode;
    dueAt: number | null;
    source: AgendaSource;
    lastTouchedTurnId: string | null;
    createdAt: number;
    updatedAt: number;
    doneAt: number | null;
}

export interface AgendaTrigger {
    id: number;
    itemId: number;
    kind: AgendaTriggerKind;
    expr: string;
    timezone: string | null;
    action: AgendaTriggerAction;
    message: string | null;
    channelHint: number;
    enabled: boolean;
    fireCount: number;
    maxFires: number;
    lastFiredAt: number | null;
    nextFireAt: number | null;
    graceWindowMs: number;
    skipNextFireAt: number | null;
    skipFireCount: number | null;
    createdAt: number;
}

export interface AgendaOccurrence {
    id: number;
    itemId: number;
    triggerId: number;
    scheduledAt: number;
    status: AgendaOccurrenceStatus;
    doneAt: number | null;
    createdAt: number;
}

export interface AgendaItemView extends AgendaItem {
    triggers: AgendaTrigger[];
    occurrences?: AgendaOccurrence[];
}

export interface AgendaCreateResult {
    item: AgendaItemView;
    created: boolean;
    existed: boolean;
}

export interface AgendaToolDescs {
    create: string;
    list: string;
    update: string;
    complete: string;
    cancel: string;
    skipNext: string;
}

export interface IAgendaService {
    getToolDescs(): AgendaToolDescs;
    create(args: AgendaCreateArgs): Promise<AgendaCreateResult>;
    list(filter?: AgendaListFilter): Promise<AgendaItemView[]>;
    update(id: number, patch: AgendaUpdatePatch): Promise<AgendaItemView | null>;
    complete(id: number): Promise<AgendaItemView | null>;
    cancel(id: number): Promise<AgendaItemView | null>;
    skipNext(id: number): Promise<AgendaItemView | null>;
    formatForLLM(filter?: AgendaListFilter): Promise<string>;
    extractFromConversation(userMessage: string, assistantMessages?: string[]): Promise<void>;
}

export const IAgendaService = Symbol("IAgendaService");
