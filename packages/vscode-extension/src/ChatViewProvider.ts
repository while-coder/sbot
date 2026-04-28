import * as vscode from 'vscode';
import { WebChatEventType, type WebChatEvent } from 'sbot.commons';
import { SbotClient } from './SbotClient';

export class ChatViewProvider {
  private panel: vscode.WebviewPanel | undefined;
  private client: SbotClient;
  private sessionId: string | undefined;
  private workPath: string;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context: vscode.ExtensionContext,
  ) {
    this.workPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? '';
    this.client = new SbotClient();
    this.client.addListener(this.onServerEvent);
  }

  async open(): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'sbotChat',
      'sbot Chat',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview')],
      },
    );

    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage(this.onWebviewMessage, this, this.context.subscriptions);
    this.panel.onDidDispose(() => { this.panel = undefined; }, this, this.context.subscriptions);

    await this.sendInit();
  }

  private async sendInit(): Promise<void> {
    const online = await this.client.isOnline();
    if (!online) {
      this.postMessage({ type: 'connectionStatus', online: false });
      return;
    }
    this.postMessage({ type: 'connectionStatus', online: true });

    const [settings, sessions] = await Promise.all([
      this.client.fetchSettings(),
      this.client.fetchSessions(this.workPath),
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
      case 'sendMessage': {
        if (!this.sessionId) return;
        this.client.sendQuery(this.sessionId, msg.text);
        break;
      }
      case 'selectSession': {
        this.sessionId = msg.sessionId;
        const history = await this.client.fetchHistory(this.sessionId);
        this.postMessage({ type: 'history', messages: history });
        break;
      }
      case 'createSession': {
        const id = await this.client.createSession(
          msg.agentId, msg.saverId, msg.memoryIds ?? [], this.workPath,
        );
        this.sessionId = id;
        this.postMessage({ type: 'sessionCreated', sessionId: id });
        break;
      }
      case 'refreshInit': {
        await this.sendInit();
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
    this.panel?.webview.postMessage(msg);
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
    this.client.dispose();
    this.panel?.dispose();
  }
}

function getNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) text += chars.charAt(Math.floor(Math.random() * chars.length));
  return text;
}
