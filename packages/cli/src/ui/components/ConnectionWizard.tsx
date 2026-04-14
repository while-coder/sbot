import React, { useState, useCallback } from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import { useKeypress, type Key } from '../hooks/useKeypress.js';
import {
  loadCliSettings,
  addRemote,
  addWorkPath,
  type RemoteEntry,
} from '../../config/cliSettings.js';
import { getServerBaseUrl } from '../../api/sbotClient.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ConnectionTarget {
  baseUrl: string;
  workPath: string;
}

interface ConnectionWizardProps {
  onReady: (target: ConnectionTarget) => void;
}

type Phase =
  | { step: 'mode-pick' }
  | { step: 'remote-pick'; remotes: RemoteEntry[] }
  | { step: 'remote-new'; field: 'host' | 'port' | 'name'; host: string; port: number }
  | { step: 'workdir-pick'; remoteIndex: number; remote: RemoteEntry }
  | { step: 'workdir-new'; remoteIndex: number; remote: RemoteEntry; field: 'path' | 'alias'; path: string };

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Simple list selector (reusable across phases). */
const ListSelect: React.FC<{
  title: string;
  hint?: string;
  items: string[];
  selectedIndex: number;
}> = ({ title, hint, items, selectedIndex }) => (
  <Box flexDirection="column" paddingX={2} paddingY={1}>
    <Text bold color={theme.text.accent}>{title}</Text>
    {hint && <Text color={theme.text.secondary}>{hint}</Text>}
    <Box flexDirection="column" marginTop={1}>
      {items.map((label, i) => (
        <Text key={i} color={i === selectedIndex ? theme.status.info : theme.text.primary}>
          {i === selectedIndex ? '▶ ' : '  '}{label}
        </Text>
      ))}
    </Box>
  </Box>
);

/** Text input field renderer. */
const TextInput: React.FC<{
  title: string;
  label: string;
  value: string;
}> = ({ title, label, value }) => (
  <Box flexDirection="column" paddingX={2} paddingY={1}>
    <Text bold color={theme.text.accent}>{title}</Text>
    <Text color={theme.text.secondary}>Type value, Enter to confirm</Text>
    <Box marginTop={1}>
      <Text color={theme.text.primary}>{label}: </Text>
      <Text color={theme.status.info}>{value}<Text color={theme.text.muted}>█</Text></Text>
    </Box>
  </Box>
);

// ── Main Component ───────────────────────────────────────────────────────────

export const ConnectionWizard: React.FC<ConnectionWizardProps> = ({ onReady }) => {
  const [phase, setPhase] = useState<Phase>({ step: 'mode-pick' });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [inputValue, setInputValue] = useState('');

  const handleKeypress = useCallback(
    (key: Key) => {
      // ── Mode pick: 本机 / 远程 ──────────────────────────────────────────
      if (phase.step === 'mode-pick') {
        if (key.name === 'up') setSelectedIndex(i => Math.max(0, i - 1));
        else if (key.name === 'down') setSelectedIndex(i => Math.min(1, i + 1));
        else if (key.name === 'return') {
          if (selectedIndex === 0) {
            // 本机
            onReady({ baseUrl: getServerBaseUrl(), workPath: process.cwd() });
          } else {
            // 远程
            const { remotes } = loadCliSettings();
            setSelectedIndex(0);
            setPhase({ step: 'remote-pick', remotes });
          }
        }
        return;
      }

      // ── Remote pick: select existing or "+ New Remote" ──────────────────
      if (phase.step === 'remote-pick') {
        const total = phase.remotes.length + 1; // +1 for "new"
        if (key.name === 'up') setSelectedIndex(i => Math.max(0, i - 1));
        else if (key.name === 'down') setSelectedIndex(i => Math.min(total - 1, i + 1));
        else if (key.name === 'return') {
          if (selectedIndex < phase.remotes.length) {
            // Selected existing remote → go to workdir pick
            const remote = phase.remotes[selectedIndex]!;
            setSelectedIndex(0);
            setPhase({ step: 'workdir-pick', remoteIndex: selectedIndex, remote });
          } else {
            // New remote — start with host
            setInputValue('');
            setPhase({ step: 'remote-new', field: 'host', host: '', port: 0 });
          }
        }
        return;
      }

      // ── Remote new: input host → port → name ───────────────────────────
      if (phase.step === 'remote-new') {
        if (key.name === 'return') {
          const val = inputValue.trim();
          if (phase.field === 'host') {
            if (!val) return; // host is required
            setInputValue('');
            setPhase({ ...phase, field: 'port', host: val });
          } else if (phase.field === 'port') {
            if (!val) return; // port is required
            const port = parseInt(val, 10) || 3000;
            // pre-fill name with host:port as default
            setInputValue(`${phase.host}:${port}`);
            setPhase({ ...phase, field: 'name', port });
          } else {
            // name — use default (host:port) if empty
            const name = val || `${phase.host}:${phase.port}`;
            const updated = addRemote(name, phase.host, phase.port);
            const newIndex = updated.remotes.length - 1;
            setSelectedIndex(0);
            setInputValue('');
            setPhase({
              step: 'workdir-pick',
              remoteIndex: newIndex,
              remote: updated.remotes[newIndex]!,
            });
          }
        } else if (key.name === 'backspace') {
          setInputValue(v => v.slice(0, -1));
        } else if (key.sequence && !key.ctrl && !key.meta) {
          setInputValue(v => v + key.sequence);
        }
        return;
      }

      // ── Workdir pick: select existing or "+ New Directory" ──────────────
      if (phase.step === 'workdir-pick') {
        const total = phase.remote.workPaths.length + 1;
        if (key.name === 'up') setSelectedIndex(i => Math.max(0, i - 1));
        else if (key.name === 'down') setSelectedIndex(i => Math.min(total - 1, i + 1));
        else if (key.name === 'return') {
          if (selectedIndex < phase.remote.workPaths.length) {
            // Selected existing workPath
            const wp = phase.remote.workPaths[selectedIndex]!;
            onReady({
              baseUrl: `http://${phase.remote.host}:${phase.remote.port}`,
              workPath: wp.path,
            });
          } else {
            // New directory
            setInputValue('');
            setPhase({
              step: 'workdir-new',
              remoteIndex: phase.remoteIndex,
              remote: phase.remote,
              field: 'path',
              path: '',
            });
          }
        }
        return;
      }

      // ── Workdir new: input path → alias ────────────────────────────────
      if (phase.step === 'workdir-new') {
        if (key.name === 'return') {
          const val = inputValue.trim();
          if (!val) return;
          if (phase.field === 'path') {
            // pre-fill alias with last segment of path
            const defaultAlias = val.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || val;
            setInputValue(defaultAlias);
            setPhase({ ...phase, field: 'alias', path: val });
          } else {
            // alias — use default if empty
            const alias = val || phase.path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || phase.path;
            const updated = addWorkPath(phase.remoteIndex, phase.path, alias);
            const remote = updated.remotes[phase.remoteIndex]!;
            onReady({
              baseUrl: `http://${remote.host}:${remote.port}`,
              workPath: phase.path,
            });
          }
        } else if (key.name === 'backspace') {
          setInputValue(v => v.slice(0, -1));
        } else if (key.sequence && !key.ctrl && !key.meta) {
          setInputValue(v => v + key.sequence);
        }
        return;
      }
    },
    [phase, selectedIndex, inputValue, onReady],
  );

  useKeypress(handleKeypress, { isActive: true });

  // ── Render ─────────────────────────────────────────────────────────────────

  if (phase.step === 'mode-pick') {
    return (
      <ListSelect
        title="Connection Mode"
        hint="↑↓ navigate  Enter select"
        items={['本机 (Local)', '远程 (Remote)']}
        selectedIndex={selectedIndex}
      />
    );
  }

  if (phase.step === 'remote-pick') {
    const items = [
      ...phase.remotes.map(r => `${r.name} (${r.host}:${r.port})`),
      '+ New Remote',
    ];
    return (
      <ListSelect
        title="Select Remote Server"
        hint="↑↓ navigate  Enter select"
        items={items}
        selectedIndex={selectedIndex}
      />
    );
  }

  if (phase.step === 'remote-new') {
    const labels: Record<string, string> = { host: 'Host / IP', port: 'Port', name: 'Name' };
    const hints: Record<string, string> = {
      host: 'Type value, Enter to confirm',
      port: 'Type value, Enter to confirm',
      name: 'Enter to confirm, or clear and type a custom name',
    };
    return (
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        <Text bold color={theme.text.accent}>New Remote Server</Text>
        <Text color={theme.text.secondary}>{hints[phase.field]!}</Text>
        <Box marginTop={1}>
          <Text color={theme.text.primary}>{labels[phase.field]!}: </Text>
          <Text color={theme.status.info}>{inputValue}<Text color={theme.text.muted}>█</Text></Text>
        </Box>
      </Box>
    );
  }

  if (phase.step === 'workdir-pick') {
    const items = [
      ...phase.remote.workPaths.map(wp => `${wp.alias} (${wp.path})`),
      '+ New Directory',
    ];
    return (
      <ListSelect
        title={`Work Directory — ${phase.remote.name}`}
        hint="↑↓ navigate  Enter select"
        items={items}
        selectedIndex={selectedIndex}
      />
    );
  }

  // workdir-new
  if (phase.step === 'workdir-new') {
    const labels: Record<string, string> = { path: 'Full Path', alias: 'Alias' };
    return <TextInput title="New Work Directory" label={labels[phase.field]!} value={inputValue} />;
  }

  return null;
};
