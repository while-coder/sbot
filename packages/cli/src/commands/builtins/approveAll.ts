import { v4 as uuidv4 } from 'uuid';
import type { Command } from '../types.js';

export const approveAllCommand: Command = {
  name: 'approve-all',
  description: '切换自动审批模式 (TODO: 需要后端 API 支持)',
  type: 'local',
  handler({ store }) {
    store.appendHistory({
      type: 'assistant',
      id: uuidv4(),
      content: 'Auto-approve toggle is not yet implemented (requires backend API).',
    });
  },
};
