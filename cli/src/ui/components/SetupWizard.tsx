import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import { useKeypress, type Key } from '../hooks/useKeypress.js';
import type { SbotSettings } from '../../api/sbotClient.js';

type WizardStep = 'agent' | 'saver' | 'memory';

interface SetupWizardProps {
  settings: SbotSettings;
  onComplete: (agentName: string, saverName: string, memoryName: string | null) => void;
}

interface SelectListProps {
  title: string;
  items: string[];
  selectedIndex: number;
}

const SelectList: React.FC<SelectListProps> = ({ title, items, selectedIndex }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text bold color={theme.text.accent}>{title}</Text>
    <Box flexDirection="column" marginTop={1}>
      {items.map((item, i) => (
        <Text key={item} color={i === selectedIndex ? theme.status.info : theme.text.primary}>
          {i === selectedIndex ? '▶ ' : '  '}{item}
        </Text>
      ))}
    </Box>
  </Box>
);

export const SetupWizard: React.FC<SetupWizardProps> = ({ settings, onComplete }) => {
  const agentNames = settings.agents.map((a) => a.name);
  const saverNames = settings.savers.map((s) => s.name);
  const memoryNames = ['(none)', ...settings.memories.map((m) => m.name)];

  const [step, setStep] = useState<WizardStep>('agent');
  const [agentIdx, setAgentIdx] = useState(0);
  const [saverIdx, setSaverIdx] = useState(0);
  const [memoryIdx, setMemoryIdx] = useState(0);

  const handleKeypress = useCallback(
    (key: Key) => {
      const lists: Record<WizardStep, { len: number; idx: number; setIdx: (i: number) => void }> = {
        agent:  { len: agentNames.length,  idx: agentIdx,  setIdx: setAgentIdx },
        saver:  { len: saverNames.length,  idx: saverIdx,  setIdx: setSaverIdx },
        memory: { len: memoryNames.length, idx: memoryIdx, setIdx: setMemoryIdx },
      };
      const cur = lists[step];

      if (key.name === 'up') {
        cur.setIdx(Math.max(0, cur.idx - 1));
      } else if (key.name === 'down') {
        cur.setIdx(Math.min(cur.len - 1, cur.idx + 1));
      } else if (key.name === 'return') {
        if (step === 'agent') setStep('saver');
        else if (step === 'saver') setStep('memory');
        else {
          const agent = agentNames[agentIdx] ?? '';
          const saver = saverNames[saverIdx] ?? '';
          const memory = memoryIdx === 0 ? null : (memoryNames[memoryIdx] ?? null);
          onComplete(agent, saver, memory);
        }
      }
    },
    [step, agentIdx, saverIdx, memoryIdx, agentNames, saverNames, memoryNames, onComplete],
  );

  useKeypress(handleKeypress, { isActive: true });

  const steps: Record<WizardStep, { title: string; items: string[]; idx: number }> = {
    agent:  { title: 'Step 1/3 — Select Agent',  items: agentNames,  idx: agentIdx },
    saver:  { title: 'Step 2/3 — Select Saver',  items: saverNames,  idx: saverIdx },
    memory: { title: 'Step 3/3 — Select Memory', items: memoryNames, idx: memoryIdx },
  };
  const cur = steps[step];

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color={theme.text.accent}>sbot-cli First Run Setup</Text>
      <Text color={theme.text.secondary}>↑↓ navigate  Enter select</Text>
      <SelectList
        title={cur.title}
        items={cur.items}
        selectedIndex={cur.idx}
      />
    </Box>
  );
};
