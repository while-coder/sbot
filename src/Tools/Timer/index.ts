/**
 * 计时器工具集
 */

import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { database, TimerType, TimerRow } from '../../Database';
import { timerService } from '../../TimeService/TimerService';
import { LoggerService } from '../../LoggerService';

const logger = LoggerService.getLogger('Tools/Timer/index.ts');

// ─────────────────────────────────────────────────────────────────────────────
// timer_list
// ─────────────────────────────────────────────────────────────────────────────

export function createTimerListTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'timer_list',
        description: '查询所有计时器列表，可按启用状态筛选。返回每条记录的 id、name、type、config、message、agentName、userId、enabled、lastRun。',
        schema: z.object({
            enabled: z.boolean().optional().describe('可选：true 只返回已启用，false 只返回已禁用，不传则返回全部'),
        }) as any,
        func: async ({ enabled }: any): Promise<MCPToolResult> => {
            try {
                const options = enabled !== undefined ? { where: { enabled } } : undefined;
                const timers = await database.findAll<TimerRow>(database.timer, options);
                return createSuccessResult(createTextContent(JSON.stringify(timers, null, 2)));
            } catch (e: any) {
                logger.error(`timer_list 失败: ${e.message}`);
                return createErrorResult(`查询计时器失败: ${e.message}`);
            }
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// timer_create
// ─────────────────────────────────────────────────────────────────────────────

export function createTimerCreateTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'timer_create',
        description: `创建新计时器，使用 cron 表达式指定触发时间（5 段：分 时 日 月 周）。常用示例：
- 每天 09:00        → "0 9 * * *"
- 每周一 09:00      → "0 9 * * 1"
- 每月 1 日 09:00   → "0 9 1 * *"
- 每隔 30 分钟      → "*/30 * * * *"
- 每小时整点        → "0 * * * *"`,
        schema: z.object({
            name:      z.string().describe('计时器名称'),
            expr:      z.string().describe('cron 表达式，5 段格式：分 时 日 月 周'),
            message:   z.string().describe('触发时发送给用户的消息文本'),
            agentName: z.string().describe('处理消息的 Agent 名称'),
            userId:    z.number().optional().describe('指定用户的数据库 ID（user 表 id 字段）'),
        }) as any,
        func: async ({ name, expr, message, agentName, userId }: any): Promise<MCPToolResult> => {
            try {
                if (!name?.trim())      return createErrorResult('name 不能为空');
                if (!expr?.trim())      return createErrorResult('expr 不能为空');
                if (!message?.trim())   return createErrorResult('message 不能为空');
                if (!agentName?.trim()) return createErrorResult('agentName 不能为空');

                const row = await database.create<TimerRow>(database.timer, {
                    name:      name.trim(),
                    type:      TimerType.Cron,
                    config:    JSON.stringify({ expr: expr.trim() }),
                    message:   message.trim(),
                    agentName: agentName.trim(),
                    userId:    userId ?? null,
                    enabled:   true,
                    lastRun:   null,
                });
                await timerService.reload((row as any).id);
                return createSuccessResult(createTextContent(`计时器已创建:\n${JSON.stringify(row, null, 2)}`));
            } catch (e: any) {
                logger.error(`timer_create 失败: ${e.message}`);
                return createErrorResult(`创建计时器失败: ${e.message}`);
            }
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// timer_delete
// ─────────────────────────────────────────────────────────────────────────────

export function createTimerDeleteTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'timer_delete',
        description: '删除指定计时器，同时取消其调度任务',
        schema: z.object({
            id: z.number().describe('计时器 id'),
        }) as any,
        func: async ({ id }: any): Promise<MCPToolResult> => {
            try {
                const existing = await database.findByPk<TimerRow>(database.timer, id);
                if (!existing) return createErrorResult(`计时器 id=${id} 不存在`);
                timerService.cancel(id);
                await database.destroy(database.timer, { where: { id } });
                return createSuccessResult(createTextContent(`计时器 id=${id}（${existing.name}）已删除`));
            } catch (e: any) {
                logger.error(`timer_delete 失败: ${e.message}`);
                return createErrorResult(`删除计时器失败: ${e.message}`);
            }
        },
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// 工具集合
// ─────────────────────────────────────────────────────────────────────────────

export function createTimerTools(): StructuredToolInterface[] {
    return [
        createTimerListTool(),
        createTimerCreateTool(),
        createTimerDeleteTool(),
    ];
}
