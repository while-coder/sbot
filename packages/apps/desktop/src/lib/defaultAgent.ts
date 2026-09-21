import { api } from './api'

/**
 * 桌面端「内置助手」：聊天窗口仅在这些固定 agent 之间切换。
 * 每次启动 upsert：不存在则创建；已存在则把 name / systemPrompt 重置为内置内容
 * （model 等其余字段保留用户设置）。
 */

export interface BuiltinAgentDef {
  id: string
  name: string
  prompt: string
}

/** 新会话默认使用的内置 agent */
export const DEFAULT_AGENT_ID = 'sbot-default'

export const BUILTIN_AGENTS: BuiltinAgentDef[] = [
  {
    id: 'sbot-default',
    name: '通用助手',
    prompt: `你是 sbot 的通用助手，一个友好、务实的 AI 助手。

- 用简洁、准确的中文回答问题；技术术语与代码保持原文。
- 回答前先理解用户意图，必要时主动追问澄清。
- 涉及代码时给出可直接运行的示例，并说明关键步骤。
- 不确定的内容如实说明，不要编造。`,
  },
  {
    id: 'sbot-coder',
    name: '编程助手',
    prompt: `你是 sbot 的编程助手，专注于软件开发全流程。

- 熟悉主流语言、框架与工具链，回答时给出可直接运行的代码。
- 先理解需求与现有代码结构，再动手写代码；关键决策简要说明理由。
- 重视代码质量：清晰的命名、合理的错误处理、必要的边界检查。
- 调试时先定位根因再修复，不要只处理表面症状。
- 不确定的内容如实说明，不要编造 API 或库的行为。`,
  },
  {
    id: 'sbot-daily',
    name: '日常助手',
    prompt: `你是 sbot 的日常助手，帮助用户处理日常工作事务。

- 擅长信息整理、文案撰写、日程规划、总结归纳等日常任务。
- 输出结构清晰：善用列表、表格与分节，重点先行。
- 语气自然友好，按用户的偏好调整详略与风格。
- 涉及事实性内容时注明不确定性，提醒用户核实关键信息。`,
  },
]

export const BUILTIN_AGENT_IDS = BUILTIN_AGENTS.map(a => a.id)

interface AgentListItem {
  id: string
  name?: string
  type?: string
  model?: string
  systemPrompt?: string
  [key: string]: unknown
}

/**
 * 确保所有内置助手存在且 name / systemPrompt 为内置内容（model 等其余字段保留用户设置）。
 * 无可用模型时跳过（Onboarding 阶段），等模型配置好后由 modelsEmpty watch / 重启重试。
 */
export async function ensureBuiltinAgents(): Promise<void> {
  try {
    const [settings, agents] = await Promise.all([
      api.get<{ models?: Record<string, unknown> }>('/api/settings'),
      api.get<AgentListItem[]>('/api/agents'),
    ])
    const models = settings?.models ?? {}
    const modelIds = Object.keys(models)

    for (const def of BUILTIN_AGENTS) {
      const existing = agents?.find(a => a.id === def.id)

      if (!existing) {
        const model = modelIds[0]
        if (!model) return
        await api.post('/api/agents', {
          id: def.id,
          name: def.name,
          type: 'single',
          model,
          systemPrompt: def.prompt,
        })
        continue
      }

      // saveAgent 是整体替换：全字段带回，name 与 systemPrompt 强制为内置内容（model 等保留用户设置）
      await api.put(`/api/agents/${def.id}`, {
        ...existing,
        name: def.name,
        systemPrompt: def.prompt,
      })
    }
  } catch (e) {
    console.error('[defaultAgent] ensureBuiltinAgents failed:', e)
  }
}
