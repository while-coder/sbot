import * as vscode from 'vscode';
import { ChatViewProvider } from './ChatViewProvider';

let provider: ChatViewProvider | undefined;

export function activate(context: vscode.ExtensionContext) {
  provider = new ChatViewProvider(context.extensionUri, context);

  context.subscriptions.push(
    vscode.commands.registerCommand('sbot.openChat', () => provider!.open()),
    { dispose: () => provider?.dispose() },
  );
}

export function deactivate() {
  provider?.dispose();
}
