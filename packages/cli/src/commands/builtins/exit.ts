import type { Command } from '../types.js';

export function createExitCommand(exitFn: () => void): Command {
  return {
    name: 'exit',
    description: '退出 CLI',
    aliases: ['quit', 'q'],
    type: 'local',
    handler() {
      exitFn();
    },
  };
}
