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

interface CreateSessionWizardProps {
  settings: SbotSettings;
  onComplete: (agentId: string, saverId: string, memoryIds: string[], agentName: string, saverName: string) => void;
}

interface SelectListProps {
  title: string;
  items: NamedItem[];
  selectedIndex: number;
  /** For multi-select mode: set of selected indices */
  checkedIndices?: Set<number>;
}

const SelectList: React.FC<SelectListProps> = ({ title, items, selectedIndex, checkedIndices }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text bold color={theme.text.accent}>{title}</Text>
    {checkedIndices && (
      <Text color={theme.text.muted}>Space toggle  Enter confirm</Text>
    )}
    <Box flexDirection="column" marginTop={1}>
      {items.map((item, i) => {
        const cursor = i === selectedIndex ? '▶ ' : '  ';
        const check = checkedIndices
          ? (checkedIndices.has(i) ? '[x] ' : '[ ] ')
          : '';
        return (
          <Text key={item.id} color={i === selectedIndex ? theme.status.info : theme.text.primary}>
            {cursor}{check}{item.name}
          </Text>
        );
      })}
    </Box>
  </Box>
);

export const CreateSessionWizard: React.FC<CreateSessionWizardProps> = ({ settings, onComplete }) => {
  const agentItems: NamedItem[] = Object.entries(settings.agents ?? {}).map(([id, a]) => ({ id, name: a.name ?? id }));
  const saverItems: NamedItem[] = Object.entries(settings.savers ?? {}).map(([id, s]) => ({ id, name: s.name ?? id }));
  const memoryItems: NamedItem[] = Object.entries(settings.memories ?? {}).map(([id, m]) => ({ id, name: m.name ?? id }));

  const [step, setStep] = useState<WizardStep>('agent');
  const [agentIdx, setAgentIdx] = useState(0);
  const [saverIdx, setSaverIdx] = useState(0);
  const [memoryIdx, setMemoryIdx] = useState(0);
  const [checkedMemories, setCheckedMemories] = useState<Set<number>>(new Set());

  const handleKeypress = useCallback(
    (key: Key) => {
      if (step === 'memory') {
        // Multi-select mode for memory
        if (key.name === 'up') {
          setMemoryIdx(i => Math.max(0, i - 1));
        } else if (key.name === 'down') {
          setMemoryIdx(i => Math.min(memoryItems.length - 1, i + 1));
        } else if (key.name === 'space') {
          setCheckedMemories(prev => {
            const next = new Set(prev);
            if (next.has(memoryIdx)) next.delete(memoryIdx);
            else next.add(memoryIdx);
            return next;
          });
        } else if (key.name === 'return') {
          const agent = agentItems[agentIdx]!;
          const saver = saverItems[saverIdx]!;
          const memoryIds = [...checkedMemories].map(i => memoryItems[i]!.id);
          onComplete(agent.id, saver.id, memoryIds, agent.name, saver.name);
        }
        return;
      }

      // Single-select mode for agent/saver
      const lists: Record<'agent' | 'saver', { len: number; idx: number; setIdx: (i: number) => void }> = {
        agent:  { len: agentItems.length,  idx: agentIdx,  setIdx: setAgentIdx },
        saver:  { len: saverItems.length,  idx: saverIdx,  setIdx: setSaverIdx },
      };
      const cur = lists[step];

      if (key.name === 'up') {
        cur.setIdx(Math.max(0, cur.idx - 1));
      } else if (key.name === 'down') {
        cur.setIdx(Math.min(cur.len - 1, cur.idx + 1));
      } else if (key.name === 'return') {
        if (step === 'agent') setStep('saver');
        else if (step === 'saver') {
          if (memoryItems.length === 0) {
            // No memories configured, skip memory step
            const agent = agentItems[agentIdx]!;
            const saver = saverItems[saverIdx]!;
            onComplete(agent.id, saver.id, [], agent.name, saver.name);
          } else {
            setStep('memory');
          }
        }
      }
    },
    [step, agentIdx, saverIdx, memoryIdx, checkedMemories, agentItems, saverItems, memoryItems, onComplete],
  );

  useKeypress(handleKeypress, { isActive: true });

  const stepNum = step === 'agent' ? 1 : step === 'saver' ? 2 : 3;
  const totalSteps = memoryItems.length > 0 ? 3 : 2;

  if (step === 'memory') {
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color={theme.text.accent}>New Session Setup</Text>
        <Text color={theme.text.secondary}>↑↓ navigate  Space toggle  Enter confirm</Text>
        <SelectList
          title={`Step ${stepNum}/${totalSteps} — Select Memories`}
          items={memoryItems}
          selectedIndex={memoryIdx}
          checkedIndices={checkedMemories}
        />
      </Box>
    );
  }

  const steps: Record<'agent' | 'saver', { title: string; items: NamedItem[]; idx: number }> = {
    agent:  { title: `Step ${stepNum}/${totalSteps} — Select Agent`,  items: agentItems,  idx: agentIdx },
    saver:  { title: `Step ${stepNum}/${totalSteps} — Select Saver`,  items: saverItems,  idx: saverIdx },
  };
  const cur = steps[step];

  return (
    <Box flexDirection="column" paddingX={2} paddingY={1}>
      <Text bold color={theme.text.accent}>New Session Setup</Text>
      <Text color={theme.text.secondary}>↑↓ navigate  Enter select</Text>
      <SelectList
        title={cur.title}
        items={cur.items}
        selectedIndex={cur.idx}
      />
    </Box>
  );
};
