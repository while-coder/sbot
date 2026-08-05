import { TimeUtils } from "../Utils/TimeUtils";
import {
    type AgendaRecord,
    type AgendaTrigger,
    type AgendaTriggerFire,
} from "./types";
import { AGENDA_MESSAGE_PREVIEW_LEN } from "./limits";

/**
 * 给 LLM（主 agent agenda_list / agenda_get / sync extractor existing-agenda）看的统一 XML 渲染。
 *
 * 设计原则：
 * - 暴露 triggerId，让 LLM 能精确引用——TriggerUpdate / TriggerRemove 才有可操作 id。
 * - 每条 trigger 的 kind/expr/action/message/nextFireAt 都列出，sync 改 9:00 那条就能定位。
 * - 三种 mode 的差别只在两点：message 给不给全文、列不列 disabled trigger（见 AgendaRenderMode）。
 */

export enum AgendaRenderMode {
    /**
     * 写操作回显：完全不输出 message，只列 active trigger。
     * agenda_create 用——message 是本次调用自己刚传的参数，回显（哪怕截断）都是复读。
     * 回显真正的价值只在 trigger id（供后续 op=update/remove 引用）与 nextFireAt（确认相对时间算成了哪一刻）。
     */
    Echo = 'echo',
    /**
     * 清单 / 超预算筛选视图：message 截断为预览，只列 active trigger。
     * agenda_list 与 AgendaSync 的候选卡片使用——invoke 类 message 是完整执行指令，
     * 初筛时只需要够区分"同一 item 上哪条 trigger"。
     */
    Compact = 'compact',
    /**
     * sync extractor 常规 / 候选终审的 <existing-agenda>：message 全文（要靠原文判断措辞是否需改写 / 是否与本轮重复），
     * 但只列 active trigger——disabled 是历史，sync 只操作在跑的调度，列了反而易误改。
     */
    Sync = 'sync',
    /**
     * 单条详情：message 全文 + 停用的 trigger + lastFiredAt。agenda_get 用。
     * 只对单个 id 生效，所以不存在全文撑爆上下文的问题。
     */
    Detail = 'detail',
}

/** 压平空白后截断，末尾加省略号提示 LLM 这不是全文（要全文走 agenda_get）。 */
function previewMessage(message: string): string {
    const flat = message.replace(/\s+/g, ' ').trim();
    if (flat.length <= AGENDA_MESSAGE_PREVIEW_LEN) return flat;
    return `${flat.slice(0, AGENDA_MESSAGE_PREVIEW_LEN)}…`;
}

/** XML 属性值转义。同时套上引号。 */
function attr(value: string): string {
    const escaped = value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    return `"${escaped}"`;
}

function renderTrigger(t: AgendaTrigger, mode: AgendaRenderMode): string {
    const parts = [
        `id="${t.id}"`,
        `kind="${t.kind}"`,
        `expr=${attr(t.expr)}`,
        `action="${t.action}"`,
    ];
    if (t.message && mode !== AgendaRenderMode.Echo) {
        const text = mode === AgendaRenderMode.Compact ? previewMessage(t.message) : t.message;
        parts.push(`message=${attr(text)}`);
    }
    if (t.nextFireAt) parts.push(`nextFireAt="${TimeUtils.formatIsoMinute(t.nextFireAt)}"`);
    if (t.maxFires > 0) {
        parts.push(`fireCount="${t.fireCount}"`);
        parts.push(`maxFires="${t.maxFires}"`);
    }
    if (mode === AgendaRenderMode.Detail) {
        // detail 才列这两个：enabled=false 只在 detail 模式出现（其余 mode 已过滤掉），
        // lastFiredAt 回答"上次到底跑没跑"。
        if (!t.enabled) parts.push(`enabled="false"`);
        if (t.lastFiredAt) parts.push(`lastFiredAt="${TimeUtils.formatIsoMinute(t.lastFiredAt)}"`);
    }
    return `  <trigger ${parts.join(' ')} />`;
}

/**
 * 把一条 AgendaRecord 渲染成单个 <agenda> 元素（含 trigger 子元素）。
 * 没有可列的 trigger 时退化为自闭合元素。
 * fires 仅 Detail 模式使用（agenda_get fires=true）；传 undefined 表示本次不查历史。
 */
export function formatAgendaXml(
    record: AgendaRecord,
    mode: AgendaRenderMode = AgendaRenderMode.Sync,
    fires?: AgendaTriggerFire[],
): string {
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
    if (mode === AgendaRenderMode.Detail) {
        headParts.push(`createdAt="${TimeUtils.formatIsoMinute(item.createdAt)}"`);
        headParts.push(`updatedAt="${TimeUtils.formatIsoMinute(item.updatedAt)}"`);
        if (item.doneAt) headParts.push(`doneAt="${TimeUtils.formatIsoMinute(item.doneAt)}"`);
    }

    const listed = mode === AgendaRenderMode.Detail
        ? record.triggers
        : record.triggers.filter(t => t.enabled);
    const children = listed.map(t => renderTrigger(t, mode));
    if (fires && mode === AgendaRenderMode.Detail) children.push(formatTriggerFiresXml(fires));

    if (children.length === 0) {
        return `<agenda ${headParts.join(' ')} />`;
    }
    return [
        `<agenda ${headParts.join(' ')}>`,
        ...children,
        `</agenda>`,
    ].join('\n');
}

/**
 * 渲染触发历史（agenda_get fires=true）。回答"昨天的巡检跑了吗、成功了吗"。
 *
 * 只给时刻 / 归属 trigger / 投递结果——触发内容本来就是 trigger.message，不重复。
 * 失败时附上 fire.message 的末行（TriggerEngine 把失败原因写在"结果："那行），
 * 用末行而不是按前缀匹配，避免依赖中文字面量。
 */
export function formatTriggerFiresXml(fires: AgendaTriggerFire[]): string {
    if (fires.length === 0) return `  <fires count="0" />`;
    const lines = fires.map(f => {
        const parts = [
            `at="${TimeUtils.formatIsoMinute(f.firedAt)}"`,
            `triggerId="${f.triggerId}"`,
            `action="${f.action}"`,
            `delivered="${f.delivered}"`,
        ];
        if (!f.delivered && f.message) {
            const lastLine = f.message.trim().split('\n').pop()?.trim();
            if (lastLine) parts.push(`result=${attr(lastLine)}`);
        }
        return `    <fire ${parts.join(' ')} />`;
    });
    return [`  <fires count="${fires.length}">`, ...lines, `  </fires>`].join('\n');
}

/** 渲染整组 records 为 LLM 可读的 XML 列表，外层包 <agenda-list>。 */
export function formatAgendaListXml(records: AgendaRecord[], mode: AgendaRenderMode = AgendaRenderMode.Sync): string {
    if (records.length === 0) return `<agenda-list count="0" />`;
    const body = records.map(r => formatAgendaXml(r, mode)).join('\n');
    return `<agenda-list count="${records.length}">\n${body}\n</agenda-list>`;
}
