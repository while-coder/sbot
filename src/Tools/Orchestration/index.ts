/**
 * 编排工具集（Stub 实现）
 * 提供 task, batch, question, todoread, todowrite, plan_enter, plan_exit 七个工具
 * 这些工具需要与 Agent 运行时深度集成，当前为 stub 实现
 */

import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { loadPrompt } from '../_prompts/index';

// ── task ────────────────────────────────────────────────────────────────────────

export function createTaskTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'task',
        description: loadPrompt('task') || '启动子 agent 执行复杂多步骤任务',
        schema: z.object({
            subagent_type: z.string().describe('子 agent 类型'),
            prompt: z.string().describe('任务描述/提示'),
            description: z.string().optional().describe('任务简短描述（3-5 词）'),
            task_id: z.string().optional().describe('已有任务 ID（用于恢复会话）'),
        }) as any,
        func: async ({ subagent_type, prompt, description }: any): Promise<MCPToolResult> => {
            return createSuccessResult(createTextContent(
                `[stub] task 工具尚未实现。请求: subagent_type=${subagent_type}, prompt=${prompt?.slice(0, 100)}...`
            ));
        },
    });
}

// ── batch ───────────────────────────────────────────────────────────────────────

export function createBatchTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'batch',
        description: loadPrompt('batch') || '并发执行多个独立工具调用',
        schema: z.object({
            tool_calls: z.array(z.object({
                tool: z.string().describe('工具名称'),
                parameters: z.record(z.string(), z.any()).describe('工具参数'),
            })).describe('要并发执行的工具调用列表（1-25 个）'),
        }) as any,
        func: async ({ tool_calls }: any): Promise<MCPToolResult> => {
            return createSuccessResult(createTextContent(
                `[stub] batch 工具尚未实现。请求了 ${tool_calls?.length || 0} 个并发调用。`
            ));
        },
    });
}

// ── question ────────────────────────────────────────────────────────────────────

export function createQuestionTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'question',
        description: loadPrompt('question') || '向用户提问以获取信息或确认',
        schema: z.object({
            question: z.string().describe('要向用户提出的问题'),
            options: z.array(z.string()).optional().describe('选项列表'),
            custom: z.boolean().optional().default(true).describe('是否允许自定义输入，默认 true'),
            multiple: z.boolean().optional().default(false).describe('是否允许多选，默认 false'),
        }) as any,
        func: async ({ question, options }: any): Promise<MCPToolResult> => {
            return createSuccessResult(createTextContent(
                `[stub] question 工具尚未实现。问题: ${question}`
            ));
        },
    });
}

// ── todoread ────────────────────────────────────────────────────────────────────

export function createTodoReadTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'todoread',
        description: loadPrompt('todoread') || '读取当前会话的待办事项列表',
        schema: z.object({
            _placeholder: z.string().optional().describe('无需传参'),
        }) as any,
        func: async (_input: any): Promise<MCPToolResult> => {
            return createSuccessResult(createTextContent(
                `[stub] todoread 工具尚未实现。当前没有待办事项。`
            ));
        },
    });
}

// ── todowrite ───────────────────────────────────────────────────────────────────

export function createTodoWriteTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'todowrite',
        description: loadPrompt('todowrite') || '创建和管理会话待办事项列表',
        schema: z.object({
            todos: z.array(z.object({
                id: z.string().describe('待办事项 ID'),
                content: z.string().describe('待办事项内容'),
                status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).describe('状态'),
                priority: z.enum(['high', 'medium', 'low']).optional().default('medium').describe('优先级'),
            })).describe('待办事项列表'),
        }) as any,
        func: async ({ todos }: any): Promise<MCPToolResult> => {
            return createSuccessResult(createTextContent(
                `[stub] todowrite 工具尚未实现。收到 ${todos?.length || 0} 个待办事项。`
            ));
        },
    });
}

// ── plan_enter ──────────────────────────────────────────────────────────────────

export function createPlanEnterTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'plan_enter',
        description: loadPrompt('plan-enter') || '建议切换到计划模式',
        schema: z.object({
            _placeholder: z.string().optional().describe('无需传参'),
        }) as any,
        func: async (_input: any): Promise<MCPToolResult> => {
            return createSuccessResult(createTextContent(
                `[stub] plan_enter 工具尚未实现。`
            ));
        },
    });
}

// ── plan_exit ───────────────────────────────────────────────────────────────────

export function createPlanExitTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'plan_exit',
        description: loadPrompt('plan-exit') || '完成计划阶段，准备退出',
        schema: z.object({
            _placeholder: z.string().optional().describe('无需传参'),
        }) as any,
        func: async (_input: any): Promise<MCPToolResult> => {
            return createSuccessResult(createTextContent(
                `[stub] plan_exit 工具尚未实现。`
            ));
        },
    });
}

// ── 导出工具集 ──────────────────────────────────────────────────────────────────

export function createOrchestrationTools(): StructuredToolInterface[] {
    return [
        createTaskTool(),
        createBatchTool(),
        createQuestionTool(),
        createTodoReadTool(),
        createTodoWriteTool(),
        createPlanEnterTool(),
        createPlanExitTool(),
    ];
}
