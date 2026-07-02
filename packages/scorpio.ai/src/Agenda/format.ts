import { TimeUtils } from "../Utils/TimeUtils";
import {
    type AgendaRecord,
    type AgendaTrigger,
} from "./types";

/**
 * 给 LLM（主 agent agenda_list / sync extractor existing-agenda）看的统一 XML 渲染。
 *
 * 设计原则：
 * - 暴露 triggerId，让 LLM 能精确引用——TriggerUpdate / TriggerRemove 才有可操作 id。
 * - 每条 trigger 的 kind/expr/action/message/nextFireAt 都列出，sync 改 9:00 那条就能定位。
 * - 只列 enabled trigger（disabled 是历史，sync 操作 active 调度，列了反而易误改）。
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

/**
 * 把一条 AgendaRecord 渲染成单个 <agenda> 元素（含 trigger 子元素）。
 * 没有 active trigger 时退化为自闭合元素。
 */
export function formatAgendaXml(record: AgendaRecord): string {
    const item = record.item;
    const headParts = [
        `id="${item.id}"`,
        `status="${item.status}"`,
        `priority="${item.priority}"`,
        `assignee="${item.assignee}"`,
    ];
    if (item.assigneeName) headParts.push(`assigneeName=${attr(item.assigneeName)}`);
    if (item.dueAt) headParts.push(`dueAt="${TimeUtils.formatIsoMinute(item.dueAt)}"`);
    headParts.push(`content=${attr(item.content)}`);

    const activeTriggers = record.triggers.filter(t => t.enabled);
    const triggerLines = activeTriggers.map(renderTrigger);

    if (triggerLines.length === 0) {
        return `<agenda ${headParts.join(' ')} />`;
    }
    return [
        `<agenda ${headParts.join(' ')}>`,
        ...triggerLines,
        `</agenda>`,
    ].join('\n');
}

/** 渲染整组 records 为 LLM 可读的 XML 列表，外层包 <agenda-list>。 */
export function formatAgendaListXml(records: AgendaRecord[]): string {
    if (records.length === 0) return `<agenda-list count="0" />`;
    const body = records.map(formatAgendaXml).join('\n');
    return `<agenda-list count="${records.length}">\n${body}\n</agenda-list>`;
}
