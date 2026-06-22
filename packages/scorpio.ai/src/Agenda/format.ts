import { TimeUtils } from "../Utils/TimeUtils";
import { OCC_DISPLAY_LIMIT } from "./limits";
import {
    AgendaCompletionMode,
    AgendaOccurrenceStatus,
    type AgendaOccurrence,
    type AgendaRecord,
    type AgendaTrigger,
} from "./types";

/**
 * 给 LLM（主 agent agenda_list / sync extractor existing-agenda）看的统一 XML 渲染。
 *
 * 设计原则：
 * - 暴露 triggerId / occurrenceId，让 LLM 能精确引用——TriggerUpdate / TriggerRemove / Complete{at} 才有可操作 id。
 * - 每条 trigger 的 kind/expr/action/message/nextFireAt 都列出，sync 改 9:00 那条就能定位。
 * - 只列 enabled trigger（disabled 是历史，sync 操作 active 调度，列了反而易误改）。
 * - Occurrence 只在 completionMode=occurrence 时输出；pending / missed 全量列，done / cancelled 截最近 N 条。
 */

/** XML 属性值转义。同时套上引号。 */
function attr(value: string): string {
    const escaped = value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    return `"${escaped}"`;
}

function renderTrigger(t: AgendaTrigger): string {
    const parts = [
        `id="${t.id}"`,
        `kind="${t.kind}"`,
        `expr=${attr(t.expr)}`,
        `action="${t.action}"`,
    ];
    if (t.message) parts.push(`message=${attr(t.message)}`);
    if (t.nextFireAt) parts.push(`nextFireAt="${TimeUtils.formatIsoMinute(t.nextFireAt)}"`);
    if (t.maxFires > 0) {
        parts.push(`fireCount="${t.fireCount}"`);
        parts.push(`maxFires="${t.maxFires}"`);
    }
    return `  <trigger ${parts.join(' ')} />`;
}

/** 选择要渲染的 occurrence：pending+missed 全量，done+cancelled 最近 OCC_DISPLAY_LIMIT 条。返回按 scheduledAt 升序。 */
function selectOccurrences(all: AgendaOccurrence[]): AgendaOccurrence[] {
    const pending: AgendaOccurrence[] = [];
    const missed: AgendaOccurrence[] = [];
    const doneTail: AgendaOccurrence[] = [];
    const cancelledTail: AgendaOccurrence[] = [];
    const doneAll: AgendaOccurrence[] = [];
    const cancelledAll: AgendaOccurrence[] = [];
    for (const o of all) {
        if (o.status === AgendaOccurrenceStatus.Pending) pending.push(o);
        else if (o.status === AgendaOccurrenceStatus.Missed) missed.push(o);
        else if (o.status === AgendaOccurrenceStatus.Done) doneAll.push(o);
        else if (o.status === AgendaOccurrenceStatus.Cancelled) cancelledAll.push(o);
    }
    doneTail.push(...[...doneAll].sort((a, b) => b.scheduledAt - a.scheduledAt).slice(0, OCC_DISPLAY_LIMIT));
    cancelledTail.push(...[...cancelledAll].sort((a, b) => b.scheduledAt - a.scheduledAt).slice(0, OCC_DISPLAY_LIMIT));
    return [...pending, ...missed, ...doneTail, ...cancelledTail].sort((a, b) => a.scheduledAt - b.scheduledAt);
}

function renderOccurrence(o: AgendaOccurrence): string {
    const parts = [
        `id="${o.id}"`,
        `scheduledAt="${TimeUtils.formatIsoMinute(o.scheduledAt)}"`,
        `status="${o.status}"`,
    ];
    if (o.doneAt) parts.push(`doneAt="${TimeUtils.formatIsoMinute(o.doneAt)}"`);
    return `  <occurrence ${parts.join(' ')} />`;
}

/**
 * 把一条 AgendaRecord 渲染成单个 <agenda> 元素（含 trigger / occurrence 子元素）。
 * 没有 active trigger 也没有 occurrence 时退化为自闭合元素。
 */
export function formatAgendaXml(record: AgendaRecord): string {
    const item = record.item;
    const headParts = [
        `id="${item.id}"`,
        `status="${item.status}"`,
        `completionMode="${item.completionMode}"`,
        `priority="${item.priority}"`,
    ];
    if (item.dueAt) headParts.push(`dueAt="${TimeUtils.formatIsoMinute(item.dueAt)}"`);
    headParts.push(`content=${attr(item.content)}`);

    const activeTriggers = record.triggers.filter(t => t.enabled);
    const triggerLines = activeTriggers.map(renderTrigger);

    let occurrenceLines: string[] = [];
    if (item.completionMode === AgendaCompletionMode.Occurrence && record.occurrences.length > 0) {
        const total = record.occurrences.length;
        const picked = selectOccurrences(record.occurrences);
        occurrenceLines = picked.map(renderOccurrence);
        const omitted = total - picked.length;
        if (omitted > 0) {
            occurrenceLines.push(`  <!-- ${omitted} earlier done/cancelled occurrences omitted -->`);
        }
    }

    const inner = [...triggerLines, ...occurrenceLines];
    if (inner.length === 0) {
        return `<agenda ${headParts.join(' ')} />`;
    }
    return [
        `<agenda ${headParts.join(' ')}>`,
        ...inner,
        `</agenda>`,
    ].join('\n');
}

/** 渲染整组 records 为 LLM 可读的 XML 列表，外层包 <agenda-list>。 */
export function formatAgendaListXml(records: AgendaRecord[]): string {
    if (records.length === 0) return `<agenda-list count="0" />`;
    const body = records.map(formatAgendaXml).join('\n');
    return `<agenda-list count="${records.length}">\n${body}\n</agenda-list>`;
}
