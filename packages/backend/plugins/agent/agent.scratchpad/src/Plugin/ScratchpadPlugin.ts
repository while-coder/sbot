import type { AgentPluginContext, AgentTool, IAgentPlugin } from "scorpio.ai";
import { SCRATCHPAD_MENU_MAX_ENTRIES } from "../limits";
import { listEntries } from "../Storage/ScratchpadStore";
import { ScratchpadToolProvider } from "../Tools/ScratchpadToolProvider";

/**
 * 会话共享黑板：ReAct 编排者与其派发的子 agent 通过同一组工具读写同一块板，
 * 共享本次协同的中间结果（发现、计算值、路径、交接说明），替代 agent 间互调接口。
 *
 * - inheritToSubAgent = true：纯协作工具，无抽取副作用，随插件继承进入子 agent
 *   （父子 agent 的 channelSessionId 同值，落同一个文件）
 * - 无 pool/lease：纯同步文件读写、无打开句柄，插件实例 per-run 构造即可
 * - 与 memory 的分工：黑板管"本次协同的中间结果"（会话结束即弃），
 *   memory 管"跨会话长期知识"——prompt 里向 agent 明确这条边界
 */
export class ScratchpadPlugin implements IAgentPlugin {
    readonly name = "scratchpad";
    readonly inheritToSubAgent = true;

    constructor(private readonly root: string) {}

    getDynamicSystemPrompt(ctx: AgentPluginContext): string | undefined {
        return ScratchpadPlugin.renderPrompt(listEntries(this.root, ctx.channelSessionId));
    }

    getTools(ctx: AgentPluginContext): AgentTool[] {
        return ScratchpadToolProvider.getTools(this.root, ctx.channelSessionId);
    }

    private static renderPrompt(rows: ReturnType<typeof listEntries>): string {
        const lines = [
            '<scratchpad>',
            'Shared scratchpad for this conversation: you and any sub-agents you dispatch',
            '(or the orchestrator that dispatched you) read and write the SAME board.',
            'Use it ONLY for intermediate results of the current collaboration — findings,',
            'computed values, file paths, handoff notes between agents. Long-term knowledge',
            'goes to memory instead; the scratchpad is discarded with the conversation.',
            '',
            'Rules:',
            '- write_scratchpad stores content verbatim under a short key; same key overwrites',
            '  (last write wins). Readers take it as-is, so write conclusions, not pointers.',
            '- read_scratchpad without a key lists what is on the board.',
            '- Delete entries that are no longer relevant to keep the board small.',
            '',
        ];
        if (rows.length === 0) {
            lines.push('Current entries: (empty)');
        } else {
            const shown = rows.slice(0, SCRATCHPAD_MENU_MAX_ENTRIES);
            lines.push(`Current entries: ${shown.map(r => `${r.key} (${r.bytes}B)`).join(' / ')}`);
            if (rows.length > shown.length) {
                lines.push(`(…and ${rows.length - shown.length} more — use read_scratchpad without a key)`);
            }
        }
        lines.push('</scratchpad>');
        return lines.join('\n');
    }
}
