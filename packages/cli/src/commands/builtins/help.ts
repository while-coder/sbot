import { v4 as uuidv4 } from 'uuid';
import type { Command } from '../types.js';
import type { CommandRegistry } from '../registry.js';

export function createHelpCommand(registry: CommandRegistry): Command {
  return {
    name: 'help',
    description: '列出所有可用命令',
    aliases: ['h', '?'],
    type: 'local',
    handler({ store }) {
      const commands = registry.getAll();
      const lines = commands.map(c => {
        const aliases = c.aliases?.length ? ` (${c.aliases.join(', ')})` : '';
        return `  /${c.name}${aliases} — ${c.description}`;
      });
      store.appendHistory({
        type: 'assistant',
        id: uuidv4(),
        content: '**Available commands:**\n' + lines.join('\n'),
      });
    },
  };
}
