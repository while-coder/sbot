import assert from "node:assert/strict";
import test from "node:test";
import {
    AgendaExtractor,
    AgendaPriority,
    AgendaSource,
    AgendaStatus,
    AgendaTriggerKind,
    MessageRole,
    SessionDeliveryMode,
    estimateMessagesTokens,
    type AgendaRecord,
    type ChatMessage,
    type IModelService,
} from "scorpio.ai";

class FakeModelService {
    readonly config = { contextWindow: 1_024 } as any;
    readonly calls: ChatMessage[][] = [];
    failCandidateCalls = false;
    analysis: any = { shouldSync: false, intents: [] };
    candidate: any = { candidates: [] };
    candidateFactory?: (messages: ChatMessage[]) => any;
    final: any = { actions: [] };
    failFinal = false;

    async invokeStructured<T>(_schema: unknown, prompt: string | ChatMessage[]): Promise<T> {
        const messages = typeof prompt === 'string'
            ? [{ role: MessageRole.Human, content: prompt }]
            : prompt;
        this.calls.push(messages);
        const system = String(messages[0]?.content ?? '');
        if (system.includes('# Conversation analysis mode')) return this.analysis as T;
        if (system.includes('# Agenda-card matching mode')) {
            if (this.failCandidateCalls) throw new Error('candidate failed');
            return (this.candidateFactory?.(messages) ?? this.candidate) as T;
        }
        if (this.failFinal) throw new Error('final failed');
        return this.final as T;
    }
}

function record(id: number, messageSize = 240): AgendaRecord {
    const now = Date.now();
    return {
        item: {
            id,
            content: `事项 ${id}`,
            status: AgendaStatus.Pending,
            priority: AgendaPriority.Normal,
            assignee: 'user' as AgendaRecord['item']['assignee'],
            assigneeName: null,
            dueAt: now + id * 60_000,
            source: AgendaSource.User,
            createdAt: now,
            updatedAt: now,
            doneAt: null,
        },
        triggers: [{
            id,
            itemId: id,
            kind: AgendaTriggerKind.Absolute,
            expr: new Date(now + id * 60_000).toISOString(),
            action: SessionDeliveryMode.Notify,
            message: `提醒 ${id} ${'长'.repeat(messageSize)}`,
            channelSessionId: 0,
            enabled: true,
            fireCount: 0,
            maxFires: 1,
            lastFiredAt: null,
            nextFireAt: now + id * 60_000,
            createdAt: now,
        }],
    };
}

function conversation(size = 1_200): ChatMessage[] {
    return [{ role: MessageRole.Human, content: `请更新事项 ${'内容'.repeat(size)}` }];
}

test("overflow selector no-sync advice does not veto the final writer", async () => {
    const model = new FakeModelService();
    const extractor = new AgendaExtractor(model as unknown as IModelService, 'writer', 'selector');

    const actions = await extractor.extract(conversation(), [record(1)]);

    assert.deepEqual(actions, []);
    assert.equal(model.calls.length, 2);
    assert.match(String(model.calls[0][0].content), /Conversation analysis mode/);
    assert.match(String(model.calls[1][0].content), /Oversized-catalog candidate contract/);
    assert.ok(model.calls.every(call => estimateMessagesTokens(call) <= 512));
});

test("overflow candidate scan has a hard six-batch model-call cap", async () => {
    const model = new FakeModelService();
    model.analysis = { shouldSync: true, intents: ['修改事项 40 的提醒时间'] };
    const extractor = new AgendaExtractor(model as unknown as IModelService, 'writer', 'selector');

    await extractor.extract(conversation(), Array.from({ length: 40 }, (_, index) => record(index + 1)));

    const candidateCalls = model.calls.filter(call => String(call[0]?.content ?? '').includes('# Agenda-card matching mode'));
    assert.equal(candidateCalls.length, 6);
    assert.equal(model.calls.length, 8); // analysis + six batches + final writer
});

test("one failed candidate batch falls back locally and still reaches the writer", async () => {
    const model = new FakeModelService();
    model.analysis = { shouldSync: true, intents: ['修改事项 1'] };
    model.failCandidateCalls = true;
    const extractor = new AgendaExtractor(model as unknown as IModelService, 'writer', 'selector');

    const actions = await extractor.extract(conversation(), [record(1)]);

    assert.deepEqual(actions, []);
    assert.equal(model.calls.length, 3);
});

test("candidate relevance scores are merged globally instead of keeping batch order", async () => {
    const model = new FakeModelService();
    model.config.contextWindow = 4_096;
    model.analysis = { shouldSync: true, intents: ['修改事项'] };
    model.candidateFactory = messages => {
        const human = String(messages[1]?.content ?? '');
        const ids = [...human.matchAll(/<agenda id="(\d+)"/g)].map(match => Number(match[1]));
        return { candidates: ids.map(id => ({ id, relevance: id })) };
    };
    const extractor = new AgendaExtractor(model as unknown as IModelService, 'writer', 'selector');

    await extractor.extract(conversation(), Array.from({ length: 8 }, (_, index) => record(index + 1)));

    const finalHuman = String(model.calls.at(-1)?.[1]?.content ?? '');
    const finalIds = [...finalHuman.matchAll(/<agenda id="(\d+)"/g)].map(match => Number(match[1]));
    assert.ok(finalIds.length > 1);
    assert.deepEqual(finalIds, [...finalIds].sort((a, b) => b - a));
});

test("a final writer failure propagates so the pending job can be marked failed", async () => {
    const model = new FakeModelService();
    model.failFinal = true;
    const extractor = new AgendaExtractor(model as unknown as IModelService, 'writer', 'selector');

    await assert.rejects(() => extractor.extract(conversation(), [record(1)]), /final failed/);
});
