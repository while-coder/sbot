import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import { useKeypress, type Key } from '../hooks/useKeypress.js';
import type { SbotSettings } from '../../api/sbotClient.js';

type WizardStep = 'agent' | 'saver' | 'memory';

interface NamedItem {
  id: string;
  name: string;
}

interface SetupWizardProps {
  settings: SbotSettings;
  onComplete: (agentId: string, saverId: string, memoryId: string | null, agentName: string, saverName: string) => void;
}

interface SelectListProps {
  title: string;
  items: NamedItem[];
  selectedIndex: number;
}

const SelectList: React.FC<SelectListProps> = ({ title, items, selectedIndex }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text bold color={theme.text.accent}>{title}</Text>
    <Box flexDirection="column" marginTop={1}>
      {items.map((item, i) => (
        <Text key={item.id} color={i === selectedIndex ? theme.status.info : theme.text.primary}>
          {i === selectedIndex ? '▶ ' : '  '}{item.name}
        </Text>
      ))}
    </Box>
  </Box>
);

export const SetupWizard: React.FC<SetupWizardProps> = ({ settings, onComplete }) => {
  const agentItems: NamedItem[] = Object.entries(settings.agents ?? {}).map(([id, a]) => ({ id, name: a.name ?? id }));
  const saverItems: NamedItem[] = Object.entries(settings.savers ?? {}).map(([id, s]) => ({ id, name: s.name ?? id }));
  const memoryItems: NamedItem[] = [
    { id: '', name: '(none)' },
    ...Object.entries(settings.memories ?? {}).map(([id, m]) => ({ id, name: m.name ?? id })),
  ];

  const [step, setStep] = useState<WizardStep>('agent');
  const [agentIdx, setAgentIdx] = useState(0);
  const [saverIdx, setSaverIdx] = useState(0);
  const [memoryIdx, setMemoryIdx] = useState(0);

  const handleKeypress = useCallback(
    (key: Key) => {
      const lists: Record<WizardStep, { len: number; idx: number; setIdx: (i: number) => void }> = {
        agent:  { len: agentItems.length,  idx: agentIdx,  setIdx: setAgentIdx },
        saver:  { len: saverItems.length,  idx: saverIdx,  setIdx: setSaverIdx },
        memory: { len: memoryItems.length, idx: memoryIdx, setIdx: setMemoryIdx },
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
          const agent = agentItems[agentIdx] ?? { id: '', name: '' };
          const saver = saverItems[saverIdx] ?? { id: '', name: '' };
          const memory = memoryIdx === 0 ? null : (memoryItems[memoryIdx] ?? null);
          onComplete(agent.id, saver.id, memory?.id ?? null, agent.name, saver.name);
        }
      }
    },
    [step, agentIdx, saverIdx, memoryIdx, agentItems, saverItems, memoryItems, onComplete],
  );

  useKeypress(handleKeypress, { isActive: true });

  const steps: Record<WizardStep, { title: string; items: NamedItem[]; idx: number }> = {
    agent:  { title: 'Step 1/3 — Select Agent',  items: agentItems,  idx: agentIdx },
    saver:  { title: 'Step 2/3 — Select Saver',  items: saverItems,  idx: saverIdx },
    memory: { title: 'Step 3/3 — Select Memory', items: memoryItems, idx: memoryIdx },
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
