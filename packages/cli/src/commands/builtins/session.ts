import { v4 as uuidv4 } from 'uuid';
import type { Command } from '../types.js';

export const sessionCommand: Command = {
  name: 'session',
  description: '显示当前会话信息',
  type: 'local',
  handler({ store }) {
    const state = store.getState();
    const lines = [
      `**Session:** ${state.sessionId ?? 'none'}`,
      `**Agent:** ${state.agentName || 'unknown'}`,
      `**Saver:** ${state.saverName || 'unknown'}`,
      `**Connection:** ${state.connection?.baseUrl ?? 'none'}`,
      `**WorkPath:** ${state.connection?.workPath ?? 'none'}`,
    ];
    store.appendHistory({
      type: 'assistant',
      id: uuidv4(),
      content: lines.join('\n'),
    });
  },
};
