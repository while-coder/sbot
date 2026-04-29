import type { ChatLabels } from './types'

export const defaultLabels: Required<ChatLabels> = {
  send: '发送',
  inputPlaceholder: '输入消息... (Enter 发送, Shift+Enter 换行)',
  stop: '中断',
  attachment: '附件',
  addAttachment: '添加附件',
  roleUser: '用户',
  roleAi: 'AI',
  thinking: '思考中...',
  think: '思考过程',
  toolCalls: '工具调用 ({count})',
  toolResult: '结果',
  noHistory: '暂无消息',
  dateToday: '今天',
  dateYesterday: '昨天',
  queued: '排队中',
  loading: '加载中...',
  download: '下载',
  close: '关闭',
  switchServer: '切换服务器',
  connected: '已连接',
  disconnected: '未连接',
  connectFailed: '无法连接到 sbot 服务器',
  retryConnect: '重试',
  selectServer: '选择服务器',
  localServer: '本机 (Local)',
  localServerDesc: '自动检测本地 sbot',
  addRemoteServer: '添加远端服务器',
  namePlaceholder: '名称 (可选)',
  save: '保存',
  cancel: '取消',
  add: '添加',
  selectSession: '选择会话',
  noSession: '暂无已有会话',
  newSession: '新建会话',
  createSession: '创建会话',
}

export function resolveLabels(partial?: ChatLabels): Required<ChatLabels> {
  if (!partial) return defaultLabels
  return { ...defaultLabels, ...partial }
}

export function tpl(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''))
}
