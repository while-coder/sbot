import { useEffect, useRef } from 'react';
import type { KeypressHandler, Key } from '../contexts/KeypressContext.js';
import { useKeypressContext } from '../contexts/KeypressContext.js';

export type { Key };

export function useKeypress(
  onKeypress: KeypressHandler,
  { isActive }: { isActive: boolean },
): void {
  const { subscribe, unsubscribe } = useKeypressContext();
  const handlerRef = useRef(onKeypress);

  // Always keep ref in sync with latest handler
  useEffect(() => {
    handlerRef.current = onKeypress;
  });

  useEffect(() => {
    if (!isActive) return;
    const stable: KeypressHandler = (key: Key) => handlerRef.current(key);
    subscribe(stable);
    return () => { unsubscribe(stable); };
  }, [isActive, subscribe, unsubscribe]);
}
