import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import type { CommandMatch } from '../../commands/types.js';

interface CommandSuggestionsProps {
  matches: CommandMatch[];
  selectedIndex: number;
}

export const CommandSuggestions: React.FC<CommandSuggestionsProps> = ({
  matches,
  selectedIndex,
}) => {
  if (matches.length === 0) return null;
  const visible = matches.slice(0, 5);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.text.muted} paddingX={1}>
      {visible.map((m, i) => {
        const focused = i === selectedIndex;
        const aliases = m.command.aliases?.length ? ` (${m.command.aliases.join(', ')})` : '';
        return (
          <Box key={m.command.name}>
            <Text color={focused ? theme.text.accent : theme.text.primary} bold={focused}>
              {focused ? '> ' : '  '}/{m.command.name}{aliases}
            </Text>
            <Text color={theme.text.muted}>  {m.command.description}</Text>
          </Box>
        );
      })}
    </Box>
  );
};
