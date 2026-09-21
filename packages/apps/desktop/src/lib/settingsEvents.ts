import { emit } from '@tauri-apps/api/event'

/** 设置保存成功后广播：主窗口收到后安全重挂 ChatView 并刷新 onboarding 状态 */
export function emitSettingsChanged(): void {
  void emit('sbot://settings-changed')
}
