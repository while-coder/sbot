# sbot-cli Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a React/Ink TUI CLI that connects to a local sbot server, runs a first-time setup wizard, then provides an interactive streaming chat interface.

**Architecture:** TypeScript + React 18 + Ink 5, following the winning.code patterns. `src/config/` handles local project config, `src/api/` wraps the sbot HTTP API, `src/ui/` contains all Ink components and hooks. `main.tsx` boots by checking for `CWD/.sbot/settings.json`, routing to either the wizard or the chat UI.

**Tech Stack:** TypeScript 5.7, React 18, Ink 5, tsx (dev), tsc (build), Node 18+ (native fetch + SSE)

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `.gitignore`

**Step 1: Create `package.json`**

```json
{
  "name": "sbot-cli",
  "version": "0.1.0",
  "description": "TUI CLI for sbot AI server",
  "type": "module",
  "bin": {
    "sbot-cli": "dist/main.js"
  },
  "scripts": {
    "dev": "tsx src/main.tsx",
    "build": "tsc",
    "clean": "rimraf dist"
  },
  "dependencies": {
    "react": "^18.3.1",
    "ink": "^5.1.0",
    "ink-spinner": "^5.0.0",
    "chalk": "^5.3.0",
    "uuid": "^10.0.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/node": "^22.0.0",
    "@types/uuid": "^10.0.0",
    "typescript": "^5.7.0",
    "tsx": "^4.19.0",
    "rimraf": "^6.0.0"
  }
}
```

**Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "jsx": "react-jsx",
    "strict": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "sourceMap": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 3: Create `.gitignore`**

```
node_modules/
dist/
.sbot/
*.js.map
```

**Step 4: Install dependencies**

```bash
cd E:/WMTools/sbot-cli
npm install
```

Expected: `node_modules/` created, no errors.

**Step 5: Commit**

```bash
git add package.json tsconfig.json .gitignore package-lock.json
git commit -m "feat: project scaffold"
```

---

### Task 2: Local config module

**Files:**
- Create: `src/config/localConfig.ts`

**Step 1: Create `src/config/localConfig.ts`**

```typescript
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface LocalConfig {
  sessionId: string;
  baseUrl: string;
  agentName: string;
  saverName: string;
  memoryName: string | null;
}

const CONFIG_DIR = '.sbot';
const CONFIG_FILE = 'settings.json';

function getConfigPath(): string {
  return join(process.cwd(), CONFIG_DIR, CONFIG_FILE);
}

export function readLocalConfig(): LocalConfig | null {
  const path = getConfigPath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as LocalConfig;
  } catch {
    return null;
  }
}

export function writeLocalConfig(cfg: LocalConfig): void {
  const dir = join(process.cwd(), CONFIG_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getConfigPath(), JSON.stringify(cfg, null, 2), 'utf-8');
}
```

**Step 2: Verify manually**

Create a quick smoke test by running:
```bash
cd E:/WMTools/sbot-cli
node --input-type=module <<'EOF'
import { writeLocalConfig, readLocalConfig } from './src/config/localConfig.ts'
EOF
```
(This will fail due to ts extension — that's fine. We'll verify it compiles cleanly in Task 9.)

**Step 3: Commit**

```bash
git add src/config/localConfig.ts
git commit -m "feat: add local config read/write"
```

---

### Task 3: sbot API client

**Files:**
- Create: `src/api/sbotClient.ts`

**Step 1: Create `src/api/sbotClient.ts`**

```typescript
export interface AgentConfig {
  name: string;
  [key: string]: unknown;
}

export interface SaverConfig {
  name: string;
  [key: string]: unknown;
}

export interface MemoryConfig {
  name: string;
  [key: string]: unknown;
}

export interface SbotSettings {
  agents: AgentConfig[];
  savers: SaverConfig[];
  memories: MemoryConfig[];
  sessions: Array<{ name: string; [key: string]: unknown }>;
}

export interface ChatEvent {
  type: 'stream' | 'message' | 'tool_call' | 'error' | 'done';
  content?: string;
  role?: string;
  tool_calls?: unknown[];
  name?: string;
  args?: unknown;
  message?: string;
}

export class SbotClient {
  constructor(private readonly baseUrl: string) {}

  async isOnline(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/settings`, { signal: AbortSignal.timeout(3000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async fetchSettings(): Promise<SbotSettings> {
    const res = await fetch(`${this.baseUrl}/api/settings`);
    if (!res.ok) throw new Error(`Failed to fetch settings: ${res.status}`);
    return res.json() as Promise<SbotSettings>;
  }

  async createSession(
    name: string,
    agentName: string,
    saverName: string,
    memoryName: string | null,
  ): Promise<void> {
    const body: Record<string, unknown> = { name, agentName, saverName };
    if (memoryName) body.memoryName = memoryName;
    const res = await fetch(`${this.baseUrl}/api/settings/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create session: ${res.status} ${text}`);
    }
  }

  async *chatStream(
    query: string,
    sessionId: string,
    signal: AbortSignal,
  ): AsyncGenerator<ChatEvent> {
    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, sessionId }),
      signal,
    });
    if (!res.ok) throw new Error(`Chat request failed: ${res.status}`);
    if (!res.body) throw new Error('No response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const dataLine = chunk.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          try {
            const event = JSON.parse(dataLine.slice(6)) as ChatEvent;
            yield event;
            if (event.type === 'done') return;
          } catch {
            // skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
```

**Step 2: Verify with TypeScript compiler**

```bash
cd E:/WMTools/sbot-cli
npx tsc --noEmit src/api/sbotClient.ts --target ES2022 --module NodeNext --moduleResolution NodeNext --strict 2>&1 | head -20
```

Expected: No errors (or only module resolution warnings that won't affect runtime).

**Step 3: Commit**

```bash
git add src/api/sbotClient.ts
git commit -m "feat: add sbot HTTP/SSE client"
```

---

### Task 4: Keypress context and hook

**Files:**
- Create: `src/ui/contexts/KeypressContext.tsx`
- Create: `src/ui/hooks/useKeypress.ts`

**Step 1: Create `src/ui/contexts/KeypressContext.tsx`**

(Directly adapted from `E:\WMTools\winning.code\src\ui\contexts\KeypressContext.tsx` — identical logic)

```typescript
import { useStdin } from 'ink';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from 'react';
import readline from 'node:readline';

export interface Key {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  sequence: string;
}

export type KeypressHandler = (key: Key) => void;

interface KeypressContextValue {
  subscribe: (handler: KeypressHandler) => void;
  unsubscribe: (handler: KeypressHandler) => void;
}

const KeypressContext = createContext<KeypressContextValue | undefined>(undefined);

export function useKeypressContext(): KeypressContextValue {
  const context = useContext(KeypressContext);
  if (!context) {
    throw new Error('useKeypressContext must be used within a KeypressProvider');
  }
  return context;
}

export function KeypressProvider({ children }: { children?: React.ReactNode }) {
  const { stdin, setRawMode } = useStdin();
  const subscribers = useRef<Set<KeypressHandler>>(new Set()).current;

  const subscribe = useCallback(
    (handler: KeypressHandler) => { subscribers.add(handler); },
    [subscribers],
  );

  const unsubscribe = useCallback(
    (handler: KeypressHandler) => { subscribers.delete(handler); },
    [subscribers],
  );

  useEffect(() => {
    const wasRaw = stdin.isRaw;
    if (!wasRaw) setRawMode(true);

    const handleKeypress = (_: unknown, key: Key) => {
      if (!key) return;
      for (const handler of subscribers) handler(key);
    };

    const rl = readline.createInterface({ input: stdin, escapeCodeTimeout: 0 });
    readline.emitKeypressEvents(stdin, rl);
    stdin.on('keypress', handleKeypress);

    return () => {
      stdin.removeListener('keypress', handleKeypress);
      rl.close();
      if (!wasRaw) setRawMode(false);
    };
  }, [stdin, setRawMode, subscribers]);

  return (
    <KeypressContext.Provider value={{ subscribe, unsubscribe }}>
      {children}
    </KeypressContext.Provider>
  );
}
```

**Step 2: Create `src/ui/hooks/useKeypress.ts`**

```typescript
import { useEffect } from 'react';
import type { KeypressHandler, Key } from '../contexts/KeypressContext.js';
import { useKeypressContext } from '../contexts/KeypressContext.js';

export type { Key };

export function useKeypress(
  onKeypress: KeypressHandler,
  { isActive }: { isActive: boolean },
): void {
  const { subscribe, unsubscribe } = useKeypressContext();

  useEffect(() => {
    if (!isActive) return;
    subscribe(onKeypress);
    return () => { unsubscribe(onKeypress); };
  }, [isActive, onKeypress, subscribe, unsubscribe]);
}
```

**Step 3: Commit**

```bash
git add src/ui/contexts/KeypressContext.tsx src/ui/hooks/useKeypress.ts
git commit -m "feat: add keypress context and hook"
```

---

### Task 5: Colors and type definitions

**Files:**
- Create: `src/ui/colors.ts`
- Create: `src/ui/types.ts`

**Step 1: Create `src/ui/colors.ts`**

```typescript
export const Colors = {
  foreground: '#e0e0e0',
  accentBlue: '#5b9bd5',
  accentCyan: '#4ec9b0',
  accentGreen: '#6a9955',
  accentYellow: '#dcdcaa',
  accentRed: '#f44747',
  accentPurple: '#c586c0',
  gray: '#808080',
  dimGray: '#505050',
} as const;

export const theme = {
  text: {
    primary: Colors.foreground,
    secondary: Colors.gray,
    accent: Colors.accentBlue,
    muted: Colors.dimGray,
  },
  status: {
    success: Colors.accentGreen,
    error: Colors.accentRed,
    warning: Colors.accentYellow,
    info: Colors.accentCyan,
  },
  prompt: {
    userPrefix: Colors.accentBlue,
    assistantPrefix: Colors.accentCyan,
  },
} as const;
```

**Step 2: Create `src/ui/types.ts`**

```typescript
export type MessageRole = 'user' | 'assistant';

export interface UserMessage {
  type: 'user';
  id: string;
  content: string;
}

export interface AssistantMessage {
  type: 'assistant';
  id: string;
  content: string;
}

export interface ToolCallMessage {
  type: 'tool_call';
  id: string;
  name: string;
  args: unknown;
}

export interface ErrorMessage {
  type: 'error';
  id: string;
  message: string;
}

export type HistoryItem =
  | UserMessage
  | AssistantMessage
  | ToolCallMessage
  | ErrorMessage;

export enum AppState {
  Loading = 'loading',
  Setup = 'setup',
  Chat = 'chat',
}

export enum StreamingState {
  Idle = 'idle',
  Responding = 'responding',
}
```

**Step 3: Commit**

```bash
git add src/ui/colors.ts src/ui/types.ts
git commit -m "feat: add colors and type definitions"
```

---

### Task 6: SetupWizard component

**Files:**
- Create: `src/ui/components/SetupWizard.tsx`

**Step 1: Create `src/ui/components/SetupWizard.tsx`**

```typescript
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
  subtitle: string;
  items: string[];
  selectedIndex: number;
}

const SelectList: React.FC<SelectListProps> = ({ title, subtitle, items, selectedIndex }) => (
  <Box flexDirection="column" marginTop={1}>
    <Text bold color={theme.text.accent}>{title}</Text>
    <Text color={theme.text.secondary}>{subtitle}</Text>
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
        subtitle=""
        items={cur.items}
        selectedIndex={cur.idx}
      />
    </Box>
  );
};
```

**Step 2: Commit**

```bash
git add src/ui/components/SetupWizard.tsx
git commit -m "feat: add setup wizard component"
```

---

### Task 7: ToolCallItem and message components

**Files:**
- Create: `src/ui/components/ToolCallItem.tsx`
- Create: `src/ui/components/MessageItem.tsx`

**Step 1: Create `src/ui/components/ToolCallItem.tsx`**

```typescript
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
```

**Step 2: Create `src/ui/components/MessageItem.tsx`**

```typescript
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import { ToolCallItem } from './ToolCallItem.js';
import type { HistoryItem } from '../types.js';

interface MessageItemProps {
  item: HistoryItem;
  isInputActive: boolean;
}

export const MessageItem: React.FC<MessageItemProps> = ({ item, isInputActive }) => {
  switch (item.type) {
    case 'user':
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={theme.prompt.userPrefix}>You</Text>
          <Text color={theme.text.primary}>{item.content}</Text>
        </Box>
      );

    case 'assistant':
      return (
        <Box flexDirection="column" marginBottom={1}>
          <Text bold color={theme.prompt.assistantPrefix}>Assistant</Text>
          <Text color={theme.text.primary}>{item.content}</Text>
        </Box>
      );

    case 'tool_call':
      return (
        <Box marginBottom={1}>
          <ToolCallItem name={item.name} args={item.args} isInputActive={isInputActive} />
        </Box>
      );

    case 'error':
      return (
        <Box marginBottom={1}>
          <Text color={theme.status.error}>Error: {item.message}</Text>
        </Box>
      );
  }
};
```

**Step 3: Commit**

```bash
git add src/ui/components/ToolCallItem.tsx src/ui/components/MessageItem.tsx
git commit -m "feat: add tool call and message item components"
```

---

### Task 8: InputPrompt component

**Files:**
- Create: `src/ui/components/InputPrompt.tsx`

**Step 1: Create `src/ui/components/InputPrompt.tsx`**

(Adapted from winning.code with identical logic)

```typescript
import React, { useState, useCallback } from 'react';
import { Text, Box } from 'ink';
import { theme } from '../colors.js';
import { useKeypress, type Key } from '../hooks/useKeypress.js';

interface InputPromptProps {
  isActive: boolean;
  onSubmit: (text: string) => void;
  onCancel: () => void;
  placeholder?: string;
}

export const InputPrompt: React.FC<InputPromptProps> = ({
  isActive,
  onSubmit,
  onCancel,
  placeholder = 'Type your message... (Shift+Enter for newline)',
}) => {
  const [input, setInput] = useState('');
  const [inputHistory, setInputHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);

  const handleKeypress = useCallback(
    (key: Key) => {
      if (key.ctrl && key.name === 'c') {
        onCancel();
        return;
      }

      if (key.name === 'return' && !key.shift) {
        const trimmed = input.trim();
        if (trimmed) {
          setInputHistory((prev) => [...prev, trimmed]);
          setHistoryIndex(-1);
          onSubmit(trimmed);
          setInput('');
        }
        return;
      }

      if (key.name === 'return' && key.shift) {
        setInput((prev) => prev + '\n');
        return;
      }

      if (key.name === 'backspace') {
        setInput((prev) => prev.slice(0, -1));
        return;
      }

      if (key.name === 'escape') {
        setInput('');
        setHistoryIndex(-1);
        return;
      }

      if (key.name === 'up') {
        if (inputHistory.length > 0) {
          const newIndex =
            historyIndex === -1
              ? inputHistory.length - 1
              : Math.max(0, historyIndex - 1);
          setHistoryIndex(newIndex);
          setInput(inputHistory[newIndex] ?? '');
        }
        return;
      }

      if (key.name === 'down') {
        if (historyIndex >= 0) {
          const newIndex = historyIndex + 1;
          if (newIndex >= inputHistory.length) {
            setHistoryIndex(-1);
            setInput('');
          } else {
            setHistoryIndex(newIndex);
            setInput(inputHistory[newIndex] ?? '');
          }
        }
        return;
      }

      if (key.ctrl && key.name === 'u') {
        setInput('');
        return;
      }

      if (key.sequence && !key.ctrl && !key.meta && key.name !== 'tab') {
        setInput((prev) => prev + key.sequence);
      }
    },
    [input, inputHistory, historyIndex, onSubmit, onCancel],
  );

  useKeypress(handleKeypress, { isActive });

  return (
    <Box flexDirection="column" marginTop={1} borderStyle="single" borderColor={theme.text.muted} paddingX={1}>
      {input.length === 0 ? (
        <Text color={theme.text.muted}>{placeholder}</Text>
      ) : (
        <Text color={theme.text.primary}>
          {input}
          <Text color={theme.text.accent}>▊</Text>
        </Text>
      )}
    </Box>
  );
};
```

**Step 2: Commit**

```bash
git add src/ui/components/InputPrompt.tsx
git commit -m "feat: add input prompt component"
```

---

### Task 9: useChat hook

**Files:**
- Create: `src/ui/hooks/useChat.ts`

**Step 1: Create `src/ui/hooks/useChat.ts`**

```typescript
import { useState, useCallback, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { SbotClient } from '../../api/sbotClient.js';
import type { HistoryItem } from '../types.js';
import { StreamingState } from '../types.js';

export interface UseChatReturn {
  history: HistoryItem[];
  streamingContent: string;
  streamingState: StreamingState;
  submitQuery: (query: string) => Promise<void>;
  cancelRequest: () => void;
  clearHistory: () => void;
}

export function useChat(client: SbotClient, sessionId: string): UseChatReturn {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingState, setStreamingState] = useState<StreamingState>(StreamingState.Idle);
  const abortRef = useRef<AbortController | null>(null);

  const submitQuery = useCallback(
    async (query: string) => {
      if (streamingState !== StreamingState.Idle) return;

      // Add user message
      const userMsg: HistoryItem = { type: 'user', id: uuidv4(), content: query };
      setHistory((prev) => [...prev, userMsg]);
      setStreamingState(StreamingState.Responding);
      setStreamingContent('');

      const abort = new AbortController();
      abortRef.current = abort;

      let accumulated = '';

      try {
        for await (const event of client.chatStream(query, sessionId, abort.signal)) {
          if (event.type === 'stream') {
            accumulated += event.content ?? '';
            setStreamingContent(accumulated);
          } else if (event.type === 'tool_call') {
            // Commit accumulated streaming content first
            if (accumulated) {
              const assistantMsg: HistoryItem = {
                type: 'assistant',
                id: uuidv4(),
                content: accumulated,
              };
              setHistory((prev) => [...prev, assistantMsg]);
              accumulated = '';
              setStreamingContent('');
            }
            const toolMsg: HistoryItem = {
              type: 'tool_call',
              id: uuidv4(),
              name: event.name ?? '',
              args: event.args,
            };
            setHistory((prev) => [...prev, toolMsg]);
          } else if (event.type === 'message') {
            const content = (event.content as string) ?? '';
            if (content) {
              const msg: HistoryItem = {
                type: 'assistant',
                id: uuidv4(),
                content,
              };
              setHistory((prev) => [...prev, msg]);
            }
          } else if (event.type === 'error') {
            const errMsg: HistoryItem = {
              type: 'error',
              id: uuidv4(),
              message: event.message ?? 'Unknown error',
            };
            setHistory((prev) => [...prev, errMsg]);
          } else if (event.type === 'done') {
            // Commit any remaining streamed content
            if (accumulated) {
              const assistantMsg: HistoryItem = {
                type: 'assistant',
                id: uuidv4(),
                content: accumulated,
              };
              setHistory((prev) => [...prev, assistantMsg]);
            }
            break;
          }
        }
      } catch (err) {
        if ((err as Error).name !== 'AbortError') {
          const errMsg: HistoryItem = {
            type: 'error',
            id: uuidv4(),
            message: (err as Error).message,
          };
          setHistory((prev) => [...prev, errMsg]);
        }
      } finally {
        setStreamingContent('');
        setStreamingState(StreamingState.Idle);
        abortRef.current = null;
      }
    },
    [client, sessionId, streamingState],
  );

  const cancelRequest = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  return { history, streamingContent, streamingState, submitQuery, cancelRequest, clearHistory };
}
```

**Step 2: Commit**

```bash
git add src/ui/hooks/useChat.ts
git commit -m "feat: add useChat hook with SSE stream management"
```

---

### Task 10: MessageList and Header/Footer components

**Files:**
- Create: `src/ui/components/MessageList.tsx`
- Create: `src/ui/components/Header.tsx`
- Create: `src/ui/components/Footer.tsx`

**Step 1: Create `src/ui/components/MessageList.tsx`**

```typescript
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import { MessageItem } from './MessageItem.js';
import type { HistoryItem } from '../types.js';

interface MessageListProps {
  history: HistoryItem[];
  streamingContent: string;
  isInputActive: boolean;
}

export const MessageList: React.FC<MessageListProps> = ({
  history,
  streamingContent,
  isInputActive,
}) => {
  return (
    <Box flexDirection="column" flexGrow={1} overflow="hidden">
      {history.length === 0 && !streamingContent && (
        <Box paddingX={2} paddingY={1}>
          <Text color={theme.text.muted}>No messages yet. Start typing below.</Text>
        </Box>
      )}
      <Box flexDirection="column" paddingX={2}>
        {history.map((item) => (
          <MessageItem key={item.id} item={item} isInputActive={isInputActive} />
        ))}
        {streamingContent && (
          <Box flexDirection="column" marginBottom={1}>
            <Text bold color={theme.prompt.assistantPrefix}>Assistant</Text>
            <Text color={theme.text.primary}>
              {streamingContent}
              <Text color={theme.text.accent}>▊</Text>
            </Text>
          </Box>
        )}
      </Box>
    </Box>
  );
};
```

**Step 2: Create `src/ui/components/Header.tsx`**

```typescript
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';

interface HeaderProps {
  sessionId: string;
  agentName: string;
  saverName: string;
  baseUrl: string;
}

export const Header: React.FC<HeaderProps> = ({ sessionId, agentName, saverName, baseUrl }) => (
  <Box borderStyle="single" borderColor={theme.text.muted} paddingX={1}>
    <Text bold color={theme.text.accent}>sbot-cli</Text>
    <Text color={theme.text.muted}>  │  </Text>
    <Text color={theme.text.secondary}>Session: </Text>
    <Text color={theme.text.primary}>{sessionId}</Text>
    <Text color={theme.text.muted}>  Agent: </Text>
    <Text color={theme.text.primary}>{agentName}</Text>
    <Text color={theme.text.muted}>  Saver: </Text>
    <Text color={theme.text.primary}>{saverName}</Text>
    <Text color={theme.text.muted}>  {baseUrl}</Text>
  </Box>
);
```

**Step 3: Create `src/ui/components/Footer.tsx`**

```typescript
import React from 'react';
import { Box, Text } from 'ink';
import { theme } from '../colors.js';
import { StreamingState } from '../types.js';

interface FooterProps {
  streamingState: StreamingState;
}

export const Footer: React.FC<FooterProps> = ({ streamingState }) => (
  <Box borderStyle="single" borderColor={theme.text.muted} paddingX={1}>
    {streamingState === StreamingState.Responding ? (
      <Text color={theme.status.warning}>Ctrl+C cancel</Text>
    ) : (
      <Text color={theme.text.muted}>
        Enter send  Shift+Enter newline  ↑↓ history  Tab fold tool_call  Ctrl+L clear  Ctrl+C exit
      </Text>
    )}
  </Box>
);
```

**Step 4: Commit**

```bash
git add src/ui/components/MessageList.tsx src/ui/components/Header.tsx src/ui/components/Footer.tsx
git commit -m "feat: add message list, header, footer components"
```

---

### Task 11: App container and main entry

**Files:**
- Create: `src/ui/App.tsx`
- Create: `src/main.tsx`

**Step 1: Create `src/ui/App.tsx`**

```typescript
import React, { useCallback } from 'react';
import { Box, useApp } from 'ink';
import type { SbotClient } from '../api/sbotClient.js';
import type { LocalConfig } from '../config/localConfig.js';
import { StreamingState } from './types.js';
import { useChat } from './hooks/useChat.js';
import { useKeypress, type Key } from './hooks/useKeypress.js';
import { Header } from './components/Header.js';
import { Footer } from './components/Footer.js';
import { MessageList } from './components/MessageList.js';
import { InputPrompt } from './components/InputPrompt.js';

interface AppProps {
  client: SbotClient;
  config: LocalConfig;
}

export const App: React.FC<AppProps> = ({ client, config }) => {
  const { exit } = useApp();
  const { history, streamingContent, streamingState, submitQuery, cancelRequest, clearHistory } =
    useChat(client, config.sessionId);

  const isIdle = streamingState === StreamingState.Idle;

  const handleSubmit = useCallback(
    async (text: string) => {
      await submitQuery(text);
    },
    [submitQuery],
  );

  const handleCancel = useCallback(() => {
    if (streamingState === StreamingState.Responding) {
      cancelRequest();
    } else {
      exit();
    }
  }, [streamingState, cancelRequest, exit]);

  // Global keys (Ctrl+L clear, Ctrl+C during stream)
  const handleGlobalKey = useCallback(
    (key: Key) => {
      if (key.ctrl && key.name === 'l') {
        clearHistory();
      }
      if (key.ctrl && key.name === 'c' && streamingState === StreamingState.Responding) {
        cancelRequest();
      }
    },
    [streamingState, cancelRequest, clearHistory],
  );

  useKeypress(handleGlobalKey, { isActive: true });

  return (
    <Box flexDirection="column" height="100%">
      <Header
        sessionId={config.sessionId}
        agentName={config.agentName}
        saverName={config.saverName}
        baseUrl={config.baseUrl}
      />
      <MessageList
        history={history}
        streamingContent={streamingContent}
        isInputActive={isIdle}
      />
      <InputPrompt
        isActive={isIdle}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
      <Footer streamingState={streamingState} />
    </Box>
  );
};
```

**Step 2: Create `src/main.tsx`**

```typescript
import React, { useState } from 'react';
import { render, Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { v4 as uuidv4 } from 'uuid';
import { readLocalConfig, writeLocalConfig, type LocalConfig } from './config/localConfig.js';
import { SbotClient, type SbotSettings } from './api/sbotClient.js';
import { KeypressProvider } from './ui/contexts/KeypressContext.js';
import { SetupWizard } from './ui/components/SetupWizard.js';
import { App } from './ui/App.js';
import { theme } from './ui/colors.js';

const BASE_URL = 'http://127.0.0.1:5500';

// ── Root bootstrap component ──────────────────────────────────────────────────

type BootState =
  | { phase: 'loading' }
  | { phase: 'setup'; settings: SbotSettings }
  | { phase: 'chat'; config: LocalConfig }
  | { phase: 'error'; message: string };

function Boot() {
  const [state, setState] = useState<BootState>({ phase: 'loading' });
  const client = new SbotClient(BASE_URL);

  // Run boot sequence on mount
  React.useEffect(() => {
    void (async () => {
      // 1. Check for existing local config
      const existing = readLocalConfig();
      if (existing) {
        setState({ phase: 'chat', config: existing });
        return;
      }

      // 2. Check if sbot is online
      const online = await client.isOnline();
      if (!online) {
        setState({ phase: 'error', message: `Cannot reach sbot at ${BASE_URL}. Is it running?` });
        return;
      }

      // 3. Fetch settings for wizard
      try {
        const settings = await client.fetchSettings();
        if (settings.agents.length === 0) {
          setState({ phase: 'error', message: 'No agents configured in sbot. Add an agent first.' });
          return;
        }
        setState({ phase: 'setup', settings });
      } catch (err) {
        setState({ phase: 'error', message: (err as Error).message });
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleWizardComplete = async (
    agentName: string,
    saverName: string,
    memoryName: string | null,
  ) => {
    const sessionId = `cli-${uuidv4()}`;
    try {
      await client.createSession(sessionId, agentName, saverName, memoryName);
      const cfg: LocalConfig = { sessionId, baseUrl: BASE_URL, agentName, saverName, memoryName };
      writeLocalConfig(cfg);
      setState({ phase: 'chat', config: cfg });
    } catch (err) {
      setState({ phase: 'error', message: (err as Error).message });
    }
  };

  if (state.phase === 'loading') {
    return (
      <Box padding={1}>
        <Text color={theme.status.info}><Spinner type="dots" /></Text>
        <Text color={theme.text.secondary}> Connecting to sbot...</Text>
      </Box>
    );
  }

  if (state.phase === 'error') {
    return (
      <Box padding={1} flexDirection="column">
        <Text color={theme.status.error}>✗ {state.message}</Text>
        <Text color={theme.text.muted}>Run sbot first, then retry.</Text>
      </Box>
    );
  }

  if (state.phase === 'setup') {
    return (
      <SetupWizard
        settings={state.settings}
        onComplete={(a, s, m) => { void handleWizardComplete(a, s, m); }}
      />
    );
  }

  // phase === 'chat'
  return <App client={client} config={state.config} />;
}

// ── Entry point ───────────────────────────────────────────────────────────────

const { waitUntilExit } = render(
  <KeypressProvider>
    <Boot />
  </KeypressProvider>,
);

waitUntilExit().then(() => process.exit(0)).catch(() => process.exit(1));
```

**Step 3: Commit**

```bash
git add src/ui/App.tsx src/main.tsx
git commit -m "feat: add app container and main entry point"
```

---

### Task 12: Build and verify

**Step 1: Type-check everything**

```bash
cd E:/WMTools/sbot-cli
npx tsc --noEmit
```

Expected: Zero errors. Fix any type errors before proceeding.

**Step 2: Run in dev mode**

```bash
npm run dev
```

Expected: TUI launches. If sbot is running at port 5500, the setup wizard appears. If sbot is not running, an error message shows.

**Step 3: Test setup wizard (requires sbot running)**

- Run sbot: `cd e:/sbot && npm run dev` (in a separate terminal)
- Run CLI: `cd E:/WMTools/sbot-cli && npm run dev`
- Use ↑↓ to navigate agents, Enter to select each step
- Verify `.sbot/settings.json` is created in the `sbot-cli` directory
- Verify the chat interface loads after wizard completes

**Step 4: Test chat**

- Type a message and press Enter
- Verify streaming output appears character by character
- Verify tool_call items appear collapsed (▶) and expand with Tab
- Verify Ctrl+L clears the history
- Verify Ctrl+C cancels a running request and again exits the app

**Step 5: Test resume (config reload)**

- Exit the app (Ctrl+C)
- Run `npm run dev` again
- Verify the setup wizard is skipped and chat loads directly

**Step 6: Build production binary**

```bash
npm run build
```

Expected: `dist/` directory created with `main.js`.

**Step 7: Final commit**

```bash
git add -A
git commit -m "feat: sbot-cli TUI complete"
```
