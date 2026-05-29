import * as vscode from 'vscode';
import { ChatViewProvider } from './ChatViewProvider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new ChatViewProvider(context.extensionUri, context);

  context.subscriptions.push(
    provider,
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand('sbot.openChat', () => {
      provider.show();
    }),
    vscode.commands.registerCommand('sbot.selectServer', () => {
      provider.selectServer();
    }),
  );
}

export function deactivate() {}
