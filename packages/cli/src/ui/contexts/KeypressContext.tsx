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
    if (!stdin.isTTY) return;
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
