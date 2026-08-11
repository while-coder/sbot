import * as vscode from 'vscode';
import { ChatViewProvider } from './ChatViewProvider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new ChatViewProvider(context.extensionUri, context);
  let editorPanel: vscode.WebviewPanel | undefined;
  let editorProvider: ChatViewProvider | undefined;

  const openChatInEditor = () => {
    if (editorPanel) {
      editorPanel.reveal(vscode.ViewColumn.Active);
      return;
    }

    editorPanel = vscode.window.createWebviewPanel(
      'sbot.chatEditor',
      'sbot',
      vscode.ViewColumn.Active,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview')],
      },
    );
    editorProvider = new ChatViewProvider(context.extensionUri, context);
    editorProvider.resolveWebviewPanel(editorPanel);
    editorPanel.onDidDispose(() => {
      editorProvider?.dispose();
      editorProvider = undefined;
      editorPanel = undefined;
    });
  };

  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('sbot.openChat', () => {
      provider.show();
    }),
    vscode.commands.registerCommand('sbot.openChatInEditor', openChatInEditor),
    vscode.commands.registerCommand('sbot.selectServer', () => {
      provider.selectServer();
    }),
  );
}

export function deactivate() {}
