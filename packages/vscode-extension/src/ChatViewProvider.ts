import * as vscode from 'vscode';
import { WebChatEventType, WsCommandType, type WebChatEvent } from 'sbot.commons';
import { SbotClient } from './SbotClient';

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

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'sbot.chatView';

  private view: vscode.WebviewView | undefined;
  private client: SbotClient | undefined;

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
  }

  private ensureClient(): SbotClient {
    if (!this.client) {
      const baseUrl = getLocalBaseUrl();
      this.client = new SbotClient(baseUrl);
      this.client.addListener(this.onServerEvent);
    }
    return this.client;
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
    const client = this.ensureClient();
    switch (method) {
      case 'listSessions':
        return client.fetchSessionsMap();
      case 'createSession':
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
      case 'mkdir':
        return client.mkdir(args[0]);
      case 'fetchThinks':
        return client.fetchThinks(args[0]);
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
        client.sendParts(args[0], args[1], args[2]);
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
    }
  }

  private onServerEvent = (event: WebChatEvent & { sessionId?: string }) => {
    const chatType = EVENT_TYPE_MAP[event.type];
    if (!chatType) return;
    this.postMessage({
      type: 'event',
      event: { type: chatType, data: event.data },
    });
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
