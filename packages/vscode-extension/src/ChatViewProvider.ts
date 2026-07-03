import * as vscode from 'vscode';
import * as path from 'node:path';
import * as os from 'node:os';
import WebSocket from 'ws';
import { WebChatEventType, WsCommandType, type WebChatEvent } from 'sbot.commons';
import { SbotClient } from './SbotClient';

const EVENT_TYPE_MAP: Record<string, string> = {
  [WebChatEventType.Human]: 'human',
  [WebChatEventType.Stream]: 'stream',
  [WebChatEventType.Message]: 'message',
  [WebChatEventType.ToolCall]: 'toolCall',
  [WebChatEventType.Ask]: 'ask',
  [WebChatEventType.Queue]: 'queue',
  [WebChatEventType.Done]: 'done',
  [WebChatEventType.Error]: 'error',
  [WebChatEventType.Usage]: 'usage',
};

type ChatViewLayout = 'auto' | 'compact' | 'wide';

export class ChatViewProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  public static readonly viewType = 'sbot.chatView';

  private view: vscode.WebviewView | undefined;
  private client: SbotClient | undefined;
  private viewDisposables: vscode.Disposable[] = [];
  /** Active pty proxy sockets, keyed by the webview-assigned id. */
  private ptySockets = new Map<number, WebSocket>();

  private readonly globalState: vscode.Memento;
  private static readonly REMOTES_KEY = 'sbot.remotes';
  private static readonly LAST_SERVER_KEY = 'sbot.lastServer';

  private customBaseUrl: string | undefined;
  private isLocalServer = false;

  constructor(
    private readonly extensionUri: vscode.Uri,
    context: vscode.ExtensionContext,
  ) {
    this.globalState = context.globalState;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.viewDisposables.forEach(d => d.dispose());
    this.viewDisposables = [];

    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };
    webviewView.title = 'SBOT';
    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(this.onWebviewMessage, undefined, this.viewDisposables);
    this.viewDisposables.push(vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('sbot.chatViewLayout')) this.postConfig();
    }));
    this.viewDisposables.push(vscode.workspace.onDidChangeWorkspaceFolders(() => this.postConfig()));
    this.viewDisposables.push(vscode.window.onDidChangeActiveTextEditor(() => this.postConfig()));
    webviewView.onDidDispose(() => {
      if (this.view === webviewView) this.view = undefined;
      this.disposeClient();
      this.viewDisposables.forEach(d => d.dispose());
      this.viewDisposables = [];
    }, undefined, this.viewDisposables);
  }

  show(): void {
    if (this.view) {
      this.view.show();
      return;
    }
    void vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
  }

  private ensureClient(): SbotClient {
    if (!this.client) {
      const baseUrl = this.customBaseUrl!;
      this.client = new SbotClient(baseUrl);
      this.client.addListener(this.onServerEvent);
    }
    return this.client;
  }

  async selectServer(): Promise<void> {
    this.show();
    const current = this.client?.baseUrl ?? '';
    const input = await vscode.window.showInputBox({
      title: 'sbot Server URL',
      prompt: 'Enter the sbot server base URL',
      value: current,
      placeHolder: 'http://localhost:5500',
    });
    if (!input) return;
    const local = isLocalBaseUrl(input);
    this.customBaseUrl = input;
    this.isLocalServer = local;
    this.closeAllPty();
    this.client?.dispose();
    this.client = undefined;
    const client = this.ensureClient();
    await client.fetchSettings();
    await this.globalState.update(ChatViewProvider.LAST_SERVER_KEY, { url: input, local });
  }

  private onWebviewMessage = async (msg: any) => {
    if (msg.type === 'rpc') {
      const { id, method, args } = msg;
      try {
        const result = await this.handleRpc(method, args);
        this.postMessage({ type: 'rpc-result', id, result });
      } catch (e: any) {
        this.postMessage({ type: 'rpc-error', id, error: e.message ?? String(e) });
      }
    } else if (msg.type === 'cmd') {
      this.handleCmd(msg.method, msg.args);
    }
  };

  private async handleRpc(method: string, args: any[]): Promise<any> {
    switch (method) {
      case 'getRemotes':
        return this.globalState.get<any[]>(ChatViewProvider.REMOTES_KEY, []);
      case 'saveRemotes':
        await this.globalState.update(ChatViewProvider.REMOTES_KEY, args[0]);
        return;
      case 'connectServer': {
        const baseUrl = args[0] as string;
        const local = Boolean(args[1]) || isLocalBaseUrl(baseUrl);
        this.customBaseUrl = baseUrl;
        this.isLocalServer = local;
        this.client?.dispose();
        this.client = undefined;
        const client = this.ensureClient();
        await client.fetchSettings();
        await this.globalState.update(ChatViewProvider.LAST_SERVER_KEY, { url: baseUrl, local });
        return;
      }
      case 'getLastServer':
        return this.globalState.get<any>(ChatViewProvider.LAST_SERVER_KEY) ?? null;
    }
    const client = this.ensureClient();
    switch (method) {
      case 'listSessions':
        return client.fetchSessions();
      case 'createSession':
        // workPath 不再在创建时绑；首条消息会带上当前 workspace folder，server 按消息粒度覆盖
        return client.createSessionNew(args[0]);
      case 'deleteSession':
        return client.deleteSession(args[0]);
      case 'updateSession':
        return client.updateSession(args[0], args[1]);
      case 'getHistory':
        return client.fetchHistory(args[0]);
      case 'clearHistory':
        return client.clearHistory(args[0]);
      case 'getUsage':
        return client.getUsage(args[0]);
      case 'getSettings':
        return client.fetchSettings();
      case 'getSessionStatus':
        return client.getSessionStatus(args[0]);
      case 'listDir':
        return client.listDir(args[0]);
      case 'quickDirs':
        return client.quickDirs();
      case 'listDrives':
        return client.listDrives();
      case 'mkdir':
        return client.mkdir(args[0]);
      case 'deleteEntry':
        return client.deleteEntry(args[0]);
      case 'uploadFile':
        return client.uploadFile(args[0], args[1], args[2]);
      case 'listTree':
        return client.listTree(args[0]);
      case 'readFile':
        return client.readFile(args[0]);
      case 'writeFile':
        return client.writeFile(args[0], args[1], args[2]);
      case 'gitStatus':
        return client.gitStatus(args[0]);
      case 'gitDiff':
        return client.gitDiff(args[0], args[1], args[2]);
      case 'fetchThinks':
        return client.fetchThinks(args[0]);
      case 'listShells':
        return client.listShells();
      case 'downloadFile':
        return this.downloadFile(args[0]);
      default:
        throw new Error(`Unknown RPC method: ${method}`);
    }
  }

  private handleCmd(method: string, args: any[]): void {
    const client = this.ensureClient();
    switch (method) {
      case 'connect':
        break;
      case 'disconnect':
        break;
      case 'sendMessage':
        client.sendParts(args[0], args[1], args[2], this.isLocalServer ? this.getWorkspaceFolder() : undefined);
        break;
      case 'approveToolCall':
        client.send(args[0], { type: WsCommandType.Approval, id: args[1].approvalId, approval: args[1].approval });
        break;
      case 'answerAsk':
        client.send(args[0], { type: WsCommandType.Ask, id: args[1].askId, answers: args[1].answers });
        break;
      case 'abort':
        client.send(args[0], { type: WsCommandType.Abort });
        break;
      case 'ptyOpen':
        this.openPty(args[0]);
        break;
      case 'ptySend':
        this.ptySend(args[0], args[1]);
        break;
      case 'ptyClose':
        this.ptyClose(args[0]);
        break;
    }
  }

  // ── Pty proxy ──
  // The webview cannot open a WebSocket directly (CSP + the server connection lives here),
  // so it drives a single pty over postMessage and we relay to the server's /ws/pty.

  private openPty(id: number): void {
    let ws: WebSocket;
    try {
      ws = this.ensureClient().openPtySocket();
    } catch (e: any) {
      this.postMessage({ type: 'pty-error', id });
      this.postMessage({ type: 'pty-close', id, reason: e?.message ?? String(e) });
      return;
    }
    this.ptySockets.set(id, ws);
    ws.on('open', () => this.postMessage({ type: 'pty-open', id }));
    // Server frames are text: raw pty bytes and JSON control frames alike.
    ws.on('message', (data: WebSocket.RawData) => {
      this.postMessage({ type: 'pty-message', id, data: data.toString('utf8') });
    });
    ws.on('error', () => this.postMessage({ type: 'pty-error', id }));
    ws.on('close', (code: number, reason: Buffer) => {
      this.ptySockets.delete(id);
      this.postMessage({ type: 'pty-close', id, code, reason: reason?.toString() });
    });
  }

  private ptySend(id: number, data: string): void {
    const ws = this.ptySockets.get(id);
    if (ws?.readyState === WebSocket.OPEN) ws.send(data);
  }

  private ptyClose(id: number): void {
    const ws = this.ptySockets.get(id);
    if (!ws) return;
    this.ptySockets.delete(id);
    try { ws.close(); } catch { /* ignore */ }
  }

  private closeAllPty(): void {
    for (const ws of this.ptySockets.values()) {
      try { ws.close(); } catch { /* ignore */ }
    }
    this.ptySockets.clear();
  }

  // ── Download ──
  // The webview can't navigate to the server URL (CSP + server connection lives here),
  // so the host fetches the bytes and saves them via the native save dialog.

  private async downloadFile(filePath: string): Promise<void> {
    const name = filePath.split(/[\\/]/).pop() || 'download';
    const baseDir = this.getWorkspaceFolder() ?? os.homedir();
    const target = await vscode.window.showSaveDialog({
      defaultUri: vscode.Uri.file(path.join(baseDir, name)),
      saveLabel: 'Download',
    });
    if (!target) return; // user cancelled the save dialog

    const client = this.ensureClient();
    let cancelled = false;
    try {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: `Downloading ${name}`, cancellable: true },
        async (progress, token) => {
          const controller = new AbortController();
          token.onCancellationRequested(() => { cancelled = true; controller.abort(); });
          let lastPct = 0;
          await client.downloadToFile(filePath, target.fsPath, {
            signal: controller.signal,
            onProgress: (loaded, total) => {
              if (!total) { progress.report({ message: formatBytes(loaded) }); return; }
              const pct = Math.floor((loaded / total) * 100);
              if (pct > lastPct) {
                progress.report({ increment: pct - lastPct, message: `${pct}% · ${formatBytes(loaded)} / ${formatBytes(total)}` });
                lastPct = pct;
              }
            },
          });
        },
      );
      void vscode.window.showInformationMessage(`Downloaded: ${target.fsPath}`);
    } catch (e: any) {
      if (cancelled) return; // user aborted — stay quiet
      void vscode.window.showErrorMessage(`Download failed: ${e?.message ?? e}`);
    }
  }

  private onServerEvent = (event: WebChatEvent) => {
    const chatType = EVENT_TYPE_MAP[event.type];
    if (!chatType) return;
    this.postMessage({
      type: 'event',
      event: { type: chatType, profileId: event.profileId, data: event.data },
    });
  };

  private getWorkspaceFolder(): string | undefined {
    const activeUri = vscode.window.activeTextEditor?.document.uri;
    if (activeUri?.scheme === 'file') {
      const folder = vscode.workspace.getWorkspaceFolder(activeUri);
      if (folder) return folder.uri.fsPath;
      return path.dirname(activeUri.fsPath);
    }
    if (vscode.workspace.workspaceFolders?.length) {
      return vscode.workspace.workspaceFolders[0].uri.fsPath;
    }
    return (vscode.workspace as any).rootPath ?? undefined;
  }

  private postMessage(msg: any): void {
    this.view?.webview.postMessage(msg);
  }

  private postConfig(): void {
    this.postMessage({
      type: 'config',
      config: this.getWebviewConfig(),
    });
  }

  private getWebviewConfig(): { chatViewLayout: ChatViewLayout; workspaceFolder: string } {
    return {
      chatViewLayout: getChatViewLayout(),
      workspaceFolder: this.getWorkspaceFolder() ?? '',
    };
  }

  private getHtml(webview: vscode.Webview): string {
    const distUri = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'index.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'index.css'));
    const nonce = getNonce();
    const configJson = JSON.stringify(this.getWebviewConfig()).replace(/</g, '\\u003c');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: https:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <title>sbot Chat</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}">window.__SBOT_VSCODE_CONFIG__=${configJson};</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private disposeClient(): void {
    this.closeAllPty();
    this.client?.dispose();
  }

  dispose(): void {
    this.disposeClient();
    this.viewDisposables.forEach(d => d.dispose());
    this.viewDisposables = [];
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${i === 0 ? value : value.toFixed(1)} ${units[i]}`;
}

function isLocalBaseUrl(baseUrl: string): boolean {
  try {
    const { hostname } = new URL(baseUrl);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

function getChatViewLayout(): ChatViewLayout {
  const value = vscode.workspace.getConfiguration('sbot').get<string>('chatViewLayout', 'compact');
  return value === 'auto' || value === 'wide' ? value : 'compact';
}
