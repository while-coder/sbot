import type { Command } from '../types.js';

export const clearCommand: Command = {
  name: 'clear',
  description: '清空聊天记录',
  aliases: ['cls'],
  type: 'local',
  handler({ store }) {
    store.clearHistory();
  },
};
