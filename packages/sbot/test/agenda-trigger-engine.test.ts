import assert from "node:assert/strict";
import test from "node:test";
import {
    AgendaPriority,
    AgendaSource,
    AgendaStatus,
    AgendaTriggerKind,
    DEFAULT_GRACE_MS,
    SessionDeliveryMode,
    type AgendaItem,
    type AgendaRecord,
    type AgendaTrigger,
    type IAgendaStore,
} from "scorpio.ai";
import { AgendaTriggerEngine } from "../src/Agenda/TriggerEngine";

function fixture(nextFireTimes: number[]): {
    engine: AgendaTriggerEngine;
    item: AgendaItem;
    triggers: AgendaTrigger[];
} {
    const now = Date.now();
    const item: AgendaItem = {
        id: 1,
        content: "test reminder",
        status: AgendaStatus.Pending,
        priority: AgendaPriority.Normal,
        assignee: 'user' as AgendaItem['assignee'],
        assigneeName: null,
        dueAt: null,
        source: AgendaSource.User,
        createdAt: now,
        updatedAt: now,
        doneAt: null,
    };
    const triggers: AgendaTrigger[] = nextFireTimes.map((nextFireAt, index) => ({
        id: index + 1,
        itemId: item.id,
        kind: AgendaTriggerKind.Absolute,
        expr: new Date(nextFireAt).toISOString(),
        action: SessionDeliveryMode.Notify,
        message: `reminder ${index + 1}`,
        channelSessionId: 0,
        enabled: true,
        fireCount: 0,
        maxFires: 1,
        lastFiredAt: null,
        nextFireAt,
        createdAt: now,
    }));

    const record = (): AgendaRecord => ({
        item: { ...item },
        triggers: triggers.map(trigger => ({ ...trigger })),
    });
    const store = {
        async listEnabledTriggers() { return triggers.filter(trigger => trigger.enabled).map(trigger => ({ ...trigger })); },
        async findTrigger(triggerId: number) {
            const trigger = triggers.find(candidate => candidate.id === triggerId);
            return trigger ? { data: record(), trigger: { ...trigger } } : null;
        },
        async findItem(itemId: number) { return itemId === item.id ? record() : null; },
        async updateTrigger(triggerId: number, fields: Partial<AgendaTrigger>) {
            const trigger = triggers.find(candidate => candidate.id === triggerId);
            if (!trigger) return null;
            Object.assign(trigger, fields);
            return record();
        },
        async updateItem(itemId: number, fields: Partial<AgendaItem>) {
            if (itemId !== item.id) return null;
            Object.assign(item, fields);
            return record();
        },
        async runExclusive<T>(fn: () => Promise<T> | T) { return fn(); },
    } as unknown as IAgendaStore;

    return { engine: new AgendaTriggerEngine("test", store), item, triggers };
}

test("a missed one-shot expires the item when no active trigger remains", async () => {
    const stale = Date.now() - DEFAULT_GRACE_MS - 1_000;
    const { engine, item, triggers } = fixture([stale]);

    await engine.start();
    engine.stopAll();

    assert.equal(triggers[0].enabled, false);
    assert.equal(triggers[0].nextFireAt, null);
    assert.equal(item.status, AgendaStatus.Expired);
    assert.equal(item.doneAt, null);
});

test("a missed trigger leaves the item pending when another trigger is active", async () => {
    const stale = Date.now() - DEFAULT_GRACE_MS - 1_000;
    const future = Date.now() + 60_000;
    const { engine, item, triggers } = fixture([stale, future]);

    await engine.start();
    engine.stopAll();

    assert.equal(triggers[0].enabled, false);
    assert.equal(triggers[1].enabled, true);
    assert.equal(item.status, AgendaStatus.Pending);
});
