import * as vscode from 'vscode';
import { ChatViewProvider } from './ChatViewProvider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new ChatViewProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, provider),
    vscode.commands.registerCommand('sbot.openChat', () => {
      vscode.commands.executeCommand(`${ChatViewProvider.viewType}.focus`);
    }),
    { dispose: () => provider.dispose() },
  );
}

export function deactivate() {}
