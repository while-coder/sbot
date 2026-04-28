import { onMounted, onUnmounted } from 'vue';
import { useChat as useChatCore, type IChatTransport, type ContentPart } from '@sbot/chat-ui';

const vscode = acquireVsCodeApi();

class VsCodeTransport implements IChatTransport {
  selectLocal() { vscode.postMessage({ type: 'selectLocal' }); }
  selectRemote(remoteIndex: number) { vscode.postMessage({ type: 'selectRemote', remoteIndex }); }
  addRemote(name: string, host: string, port: number) { vscode.postMessage({ type: 'addRemote', name, host, port }); }
  updateRemote(remoteIndex: number, patch: { name?: string; host?: string; port?: number }) { vscode.postMessage({ type: 'updateRemote', remoteIndex, patch }); }
  removeRemote(remoteIndex: number) { vscode.postMessage({ type: 'removeRemote', remoteIndex }); }
  backToServerPick() { vscode.postMessage({ type: 'backToServerPick' }); }
  selectSession(sessionId: string) { vscode.postMessage({ type: 'selectSession', sessionId }); }
  createSession(agentId: string, saverId: string, memoryIds: string[]) { vscode.postMessage({ type: 'createSession', agentId, saverId, memoryIds }); }
  sendMessage(parts: ContentPart[]) { vscode.postMessage({ type: 'sendMessage', parts }); }
  updateSessionConfig(field: string, value: any) { vscode.postMessage({ type: 'updateSessionConfig', field, value }); }
  retry() { vscode.postMessage({ type: 'refreshInit' }); }
}

export function useChat() {
  const transport = new VsCodeTransport();
  const chat = useChatCore(transport);

  function onMessage(event: MessageEvent) {
    chat.handleMessage(event.data);
  }

  onMounted(() => window.addEventListener('message', onMessage));
  onUnmounted(() => window.removeEventListener('message', onMessage));

  return chat;
}
