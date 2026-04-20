import { v4 as uuidv4 } from 'uuid';
import type { Command } from '../types.js';

export const compactCommand: Command = {
  name: 'compact',
  description: '压缩历史记录，仅保留最近 N 条 (默认 20)',
  type: 'local',
  handler({ store, args }) {
    const n = parseInt(args, 10) || 20;
    const state = store.getState();
    const trimmed = state.history.slice(-n);
    store.setState({ history: trimmed });
    store.appendHistory({
      type: 'assistant',
      id: uuidv4(),
      content: `History compacted to last ${trimmed.length} items.`,
    });
  },
};
