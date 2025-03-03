import * as vscode from 'vscode';
import * as p from 'child_process';
import { global } from './references-utils';

// Provides auto-completion items from GNU Global tags
export class ReferencesCompletionItemProvider implements vscode.CompletionItemProvider {
    private completionItems: vscode.CompletionItem[] = [];

    constructor() {
        this.initializeCompletionItems();
    }

    private initializeCompletionItems() {
        const cwd = vscode.workspace.workspaceFolders?.[0].uri.path;
        const child = p.spawn(global(), ['-cT'], { cwd });

        let buffer = '';
        let errors = '';

        child.stdout.on('data', (data: Buffer) => {
            const text = buffer + data.toString();
            const lastNewline = text.lastIndexOf('\n');

            this.completionItems = this.completionItems.concat(
                text
                    .substring(0, lastNewline)
                    .split('\n')
                    .map((s) => new vscode.CompletionItem(s)),
            );

            buffer = text.substring(lastNewline + 1);
        });

        child.stderr.on('data', (data: Buffer) => {
            errors += data.toString();
        });

        child.on('close', (code) => {
            if (code !== 0) {
                vscode.window.showInformationMessage(
                    `Error generating completion data (code ${code}).\n\n${errors}`,
                );
            } else if (buffer) {
                this.completionItems.push(new vscode.CompletionItem(buffer));
            }
        });
    }

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext,
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        return this.completionItems;
    }
}
