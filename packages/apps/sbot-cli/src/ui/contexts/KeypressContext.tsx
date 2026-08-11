import { useInput, type Key as InkKey } from 'ink';
import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
} from 'react';

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

function getKeyName(input: string, key: InkKey): string {
  if (input === '\\\r' || input === '\\\r\n') return 'return';
  if (key.return) return 'return';
  if (key.escape) return 'escape';
  if (key.upArrow) return 'up';
  if (key.downArrow) return 'down';
  if (key.leftArrow) return 'left';
  if (key.rightArrow) return 'right';
  if (key.tab) return 'tab';
  if (key.backspace) return 'backspace';
  if (key.delete) return 'delete';
  if (key.home) return 'home';
  if (key.end) return 'end';
  if (input === ' ') return 'space';
  return input.length === 1 ? input.toLowerCase() : 'undefined';
}

export function useKeypressContext(): KeypressContextValue {
  const context = useContext(KeypressContext);
  if (!context) {
    throw new Error('useKeypressContext must be used within a KeypressProvider');
  }
  return context;
}

export function KeypressProvider({ children }: { children?: React.ReactNode }) {
  const subscribers = useRef<Set<KeypressHandler>>(new Set()).current;

  const subscribe = useCallback(
    (handler: KeypressHandler) => { subscribers.add(handler); },
    [subscribers],
  );

  const unsubscribe = useCallback(
    (handler: KeypressHandler) => { subscribers.delete(handler); },
    [subscribers],
  );

  useInput((input, key) => {
    if (key.eventType === 'release') return;
    const isSoftReturn = input === '\\\r' || input === '\\\r\n';
    const normalized: Key = {
      name: getKeyName(input, key),
      ctrl: key.ctrl,
      meta: key.meta,
      shift: key.shift || isSoftReturn,
      sequence: isSoftReturn ? '\r' : input,
    };
    for (const handler of subscribers) handler(normalized);
  });

  return (
    <KeypressContext.Provider value={{ subscribe, unsubscribe }}>
      {children}
    </KeypressContext.Provider>
  );
}
