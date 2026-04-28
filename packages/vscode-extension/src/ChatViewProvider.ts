import * as vscode from 'vscode';
import { WebChatEventType, type WebChatEvent } from 'sbot.commons';
import { SbotClient } from './SbotClient';
import { loadCliSettings, addRemote, updateRemote, removeRemote } from './cliSettings';

function getLocalBaseUrl(): string {
  const { readFileSync, existsSync } = require('node:fs');
  const { join } = require('node:path');
  const { homedir } = require('node:os');
  const { DEFAULT_PORT } = require('sbot.commons');
  try {
    const p = join(homedir(), '.sbot', 'settings.json');
    if (existsSync(p)) {
      const s = JSON.parse(readFileSync(p, 'utf-8'));
      return `http://localhost:${s.httpPort ?? DEFAULT_PORT}`;
    }
  } catch { /* use default */ }
  return `http://localhost:${DEFAULT_PORT}`;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'sbot.chatView';

  private view: vscode.WebviewView | undefined;
  private client: SbotClient | undefined;
  private sessionId: string | undefined;
  private workPath = '';

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage(this.onWebviewMessage);
    webviewView.onDidDispose(() => { this.view = undefined; });

    this.sendServerList();
  }

  private sendServerList(): void {
    const { remotes } = loadCliSettings();
    this.postMessage({ type: 'serverList', remotes });
  }

  private switchClient(baseUrl: string): void {
    this.client?.dispose();
    this.client = new SbotClient(baseUrl);
    this.client.addListener(this.onServerEvent);
    this.sessionId = undefined;
  }

  private async sendInit(): Promise<void> {
    if (!this.client) return;

    const online = await this.client.isOnline();
    if (!online) {
      this.postMessage({ type: 'connectionStatus', online: false });
      return;
    }
    this.postMessage({ type: 'connectionStatus', online: true });

    const [settings, sessions] = await Promise.all([
      this.client.fetchSettings(),
      this.client.fetchSessions(),
    ]);

    this.postMessage({
      type: 'init',
      settings,
      sessions,
      workPath: this.workPath,
    });
  }

  private onWebviewMessage = async (msg: any) => {
    switch (msg.type) {
      case 'selectLocal': {
        this.workPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
        this.switchClient(getLocalBaseUrl());
        await this.sendInit();
        break;
      }
      case 'selectRemote': {
        const { remotes } = loadCliSettings();
        const remote = remotes[msg.remoteIndex];
        if (!remote) return;
        this.workPath = '';
        this.switchClient(`http://${remote.host}:${remote.port}`);
        await this.sendInit();
        break;
      }
      case 'addRemote': {
        const settings = addRemote(msg.name || `${msg.host}:${msg.port}`, msg.host, msg.port);
        const remote = settings.remotes[settings.remotes.length - 1]!;
        this.workPath = '';
        this.switchClient(`http://${remote.host}:${remote.port}`);
        await this.sendInit();
        break;
      }
      case 'updateRemote': {
        updateRemote(msg.remoteIndex, msg.patch);
        this.sendServerList();
        break;
      }
      case 'removeRemote': {
        removeRemote(msg.remoteIndex);
        this.sendServerList();
        break;
      }
      case 'backToServerPick': {
        this.client?.dispose();
        this.client = undefined;
        this.sessionId = undefined;
        this.sendServerList();
        break;
      }
      case 'sendMessage': {
        if (!this.sessionId || !this.client) return;
        this.client.sendParts(this.sessionId, msg.parts);
        break;
      }
      case 'selectSession': {
        if (!this.client) return;
        this.sessionId = msg.sessionId;
        const history = await this.client.fetchHistory(this.sessionId!);
        this.postMessage({ type: 'history', messages: history });
        break;
      }
      case 'createSession': {
        if (!this.client) return;
        const id = await this.client.createSession(
          msg.agentId, msg.saverId, msg.memoryIds ?? [], this.workPath,
        );
        this.sessionId = id;
        this.postMessage({
          type: 'sessionCreated', sessionId: id,
          agent: msg.agentId, saver: msg.saverId, memories: msg.memoryIds ?? [],
        });
        break;
      }
      case 'updateSessionConfig': {
        if (!this.sessionId || !this.client) return;
        const patch: Record<string, any> = {};
        patch[msg.field] = msg.value;
        try {
          await this.client.updateSession(this.sessionId, patch);
        } catch (e: any) {
          this.postMessage({ type: 'error', message: e.message });
        }
        break;
      }
      case 'refreshInit': {
        if (this.client) {
          await this.sendInit();
        } else {
          this.sendServerList();
        }
        break;
      }
    }
  };

  private onServerEvent = (event: WebChatEvent & { sessionId?: string }) => {
    if (event.sessionId && event.sessionId !== this.sessionId) return;
    switch (event.type) {
      case WebChatEventType.Stream:
        this.postMessage({ type: 'streamChunk', content: event.data });
        break;
      case WebChatEventType.Message:
        this.postMessage({ type: 'messageComplete', data: event.data });
        break;
      case WebChatEventType.Human:
        this.postMessage({ type: 'humanEcho', data: event.data });
        break;
      case WebChatEventType.Done:
        this.postMessage({ type: 'done', data: event.data });
        break;
      case WebChatEventType.Error:
        this.postMessage({ type: 'error', message: (event.data as any).message });
        break;
    }
  };

  private postMessage(msg: any): void {
    this.view?.webview.postMessage(msg);
  }

  private getHtml(webview: vscode.Webview): string {
    const distUri = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'index.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distUri, 'index.css'));
    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <title>sbot Chat</title>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  dispose(): void {
    this.client?.dispose();
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
