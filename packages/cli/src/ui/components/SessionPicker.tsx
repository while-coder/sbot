import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import { useKeypress, type Key } from '../hooks/useKeypress.js';
import type { SessionItem } from '../../api/sbotClient.js';

interface SessionPickerProps {
  sessions: SessionItem[];
  agentNames: Record<string, string>;
  onSelect: (sessionId: string, agentName: string, saverName: string) => void;
  onCreateNew: () => void;
}

export const SessionPicker: React.FC<SessionPickerProps> = ({
  sessions,
  agentNames,
  onSelect,
  onCreateNew,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const totalItems = sessions.length + 1; // +1 for "create new"

  const handleKeypress = useCallback(
    (key: Key) => {
      if (key.name === 'up') {
        setSelectedIndex(i => Math.max(0, i - 1));
      } else if (key.name === 'down') {
        setSelectedIndex(i => Math.min(totalItems - 1, i + 1));
      } else if (key.name === 'return') {
        if (selectedIndex < sessions.length) {
          const s = sessions[selectedIndex]!;
          onSelect(s.id, agentNames[s.agent] ?? s.agent, s.name ?? s.id);
        } else {
          onCreateNew();
        }
      }
    },
    [selectedIndex, sessions, totalItems, agentNames, onSelect, onCreateNew],
  );

  useKeypress(handleKeypress, { isActive: true });

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color={theme.text.accent}>Select Session</Text>
      <Text color={theme.text.secondary}>↑↓ navigate  Enter select</Text>
      <Box flexDirection="column" marginTop={1}>
        {sessions.map((s, i) => (
          <Text
            key={s.id}
            color={i === selectedIndex ? theme.status.info : theme.text.primary}
          >
            {i === selectedIndex ? '▶ ' : '  '}
            {s.name ?? s.id}
            <Text color={theme.text.muted}> ({agentNames[s.agent] ?? s.agent})</Text>
          </Text>
        ))}
        <Text
          color={selectedIndex === sessions.length ? theme.status.info : theme.text.primary}
        >
          {selectedIndex === sessions.length ? '▶ ' : '  '}
          + New Session
        </Text>
      </Box>
    </Box>
  );
};
