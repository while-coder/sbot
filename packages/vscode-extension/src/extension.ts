import * as vscode from 'vscode';
import { ChatPanel } from './ChatViewProvider';

export function activate(context: vscode.ExtensionContext) {
  let panel: ChatPanel | undefined;

  context.subscriptions.push(
    vscode.commands.registerCommand('sbot.openChat', () => {
      panel = ChatPanel.createOrShow(context.extensionUri, context);
    }),
    vscode.commands.registerCommand('sbot.selectServer', () => {
      if (!panel) panel = ChatPanel.createOrShow(context.extensionUri, context);
      panel.selectServer();
    }),
  );
}

export function deactivate() {}
