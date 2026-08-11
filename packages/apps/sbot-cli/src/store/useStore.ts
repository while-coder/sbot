import { useSyncExternalStore, useCallback, useRef } from 'react';
import type { AppState, AppStateStore } from './AppStateStore.js';
import { createContext, useContext } from 'react';

export const StoreContext = createContext<AppStateStore>(null!);

export function useStore(): AppState;
export function useStore<T>(selector: (state: AppState) => T): T;
export function useStore<T>(selector?: (state: AppState) => T): T | AppState {
  const store = useContext(StoreContext);
  const selectorRef = useRef(selector);
  selectorRef.current = selector;

  const getSnapshot = useCallback(() => {
    const state = store.getState();
    return selectorRef.current ? selectorRef.current(state) : state;
  }, [store]);

  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribe(onStoreChange),
    [store],
  );

  return useSyncExternalStore(subscribe, getSnapshot);
}
