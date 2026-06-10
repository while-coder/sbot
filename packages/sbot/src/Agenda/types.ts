export type AgendaItemRow = {
    id: number;
    profileId: number;
    content: string;
    status: string;
    priority: string;
    category: string;
    completionMode: string;
    dueAt: number | null;
    source: string;
    lastTouchedTurnId: string | null;
    createdAt: number;
    updatedAt: number;
    doneAt: number | null;
};

export type AgendaStoredItemRow = Omit<AgendaItemRow, "profileId">;

export type AgendaTriggerRow = {
    id: number;
    itemId: number;
    kind: string;
    expr: string;
    timezone: string | null;
    action: string;
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
};

export type AgendaOccurrenceRow = {
    id: number;
    itemId: number;
    triggerId: number;
    scheduledAt: number;
    status: string;
    doneAt: number | null;
    createdAt: number;
};

export type AgendaFireLogRow = {
    id: number;
    itemId: number;
    triggerId: number;
    firedAt: number;
    action: string;
    channelSessionId: number | null;
    ok: boolean;
    errorMessage: string | null;
};
