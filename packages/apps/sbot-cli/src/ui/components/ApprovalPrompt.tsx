import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import { useKeypress, type Key } from '../hooks/useKeypress.js';
import type { PendingApproval } from '../types.js';

const APPROVAL_OPTIONS = [
  { label: 'Allow',              value: 'allow' },
  { label: 'Always allow',      value: 'alwaysTool' },
  { label: 'Always (same args)', value: 'alwaysArgs' },
  { label: 'Deny',              value: 'deny' },
] as const;

interface ApprovalPromptProps {
  pending: PendingApproval;
  onResolve: (approval: string) => void;
}

export const ApprovalPrompt: React.FC<ApprovalPromptProps> = ({ pending, onResolve }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [argsExpanded, setArgsExpanded] = useState(false);

  const handleKeypress = useCallback(
    (key: Key) => {
      if (key.name === 'up') {
        setSelectedIndex((i) => (i > 0 ? i - 1 : APPROVAL_OPTIONS.length - 1));
      } else if (key.name === 'down') {
        setSelectedIndex((i) => (i < APPROVAL_OPTIONS.length - 1 ? i + 1 : 0));
      } else if (key.name === 'return') {
        onResolve(APPROVAL_OPTIONS[selectedIndex].value);
      } else if (key.name === 'tab') {
        setArgsExpanded((e) => !e);
      }
    },
    [selectedIndex, onResolve],
  );

  useKeypress(handleKeypress, { isActive: true });

  const argsText = JSON.stringify(pending.args, null, 2);

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={theme.status.warning} paddingX={1}>
      <Text bold color={theme.status.warning}>
        Tool approval required: {pending.name}
      </Text>
      <Box marginTop={0}>
        <Text color={theme.text.muted}>
          {argsExpanded ? '▼' : '▶'} args (Tab to toggle)
        </Text>
      </Box>
      {argsExpanded && (
        <Box marginLeft={2}>
          <Text color={theme.text.muted}>{argsText}</Text>
        </Box>
      )}
      <Box flexDirection="column" marginTop={1}>
        {APPROVAL_OPTIONS.map((opt, i) => (
          <Text key={opt.value} color={i === selectedIndex ? theme.text.accent : theme.text.primary}>
            {i === selectedIndex ? '❯ ' : '  '}{opt.label}
          </Text>
        ))}
      </Box>
      <Box marginTop={1}>
        <Text color={theme.text.muted}>↑↓ select  Enter confirm  Tab toggle args</Text>
      </Box>
    </Box>
  );
};
