import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import { useKeypress, type Key } from '../hooks/useKeypress.js';

interface ToolCallItemProps {
  name: string;
  args: unknown;
  isInputActive: boolean;
}

export const ToolCallItem: React.FC<ToolCallItemProps> = ({ name, args, isInputActive }) => {
  const [expanded, setExpanded] = useState(false);

  const handleKeypress = useCallback(
    (key: Key) => {
      if (key.name === 'tab') {
        setExpanded((e) => !e);
      }
    },
    [],
  );

  // Only handle Tab when input is active (idle state)
  useKeypress(handleKeypress, { isActive: isInputActive });

  const argsText = typeof args === 'string' ? args : JSON.stringify(args, null, 2);

  return (
    <Box flexDirection="column" marginY={0}>
      <Text color={theme.status.warning}>
        {expanded ? '▼' : '▶'} [tool_call] {name}
      </Text>
      {expanded && (
        <Box marginLeft={2} marginBottom={1}>
          <Text color={theme.text.muted}>{argsText}</Text>
        </Box>
      )}
    </Box>
  );
};
