/// <reference types="vite/client" />
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<{}, {}, any>;
  export default component;
}

interface VsCodeApi {
  postMessage(msg: any): void;
  getState(): any;
  setState(state: any): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

interface Window {
  __SBOT_VSCODE_CONFIG__?: {
    chatViewLayout?: 'auto' | 'compact' | 'wide';
    workspaceFolder?: string;
  };
}
