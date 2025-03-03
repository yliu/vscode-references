import * as vscode from 'vscode';
import { Reference } from './references-treeitem';
import { ReferencesProvider } from './references-treedata-provider';
import { ReferencesDefinitionProvider } from './references-definition-provider';
import { ReferencesCompletionItemProvider } from './references-completion-item-provider';
import { ReferencesDocumentSymbolProvider } from './references-document-symbol-provider';
import { preCheck, isCompletion } from './references-utils';

// Extension activation and deactivation
export function activate(context: vscode.ExtensionContext) {
    preCheck();

    const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.path || '';
    const treeDataProvider = new ReferencesProvider(workspacePath);

    const treeView = vscode.window.createTreeView('references.references', {
        treeDataProvider,
    });

    const definitionProvider = new ReferencesDefinitionProvider();
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider({ scheme: 'file' }, definitionProvider),
    );

    registerCommands(context, treeDataProvider, treeView);

    if (isCompletion()) {
        registerCompletionProvider(context);
    }

    registerDocumentSymbolProvider(context);
}

async function handleShowInfo() {
    const selection = await vscode.window.showInformationMessage(
        'References - Search and track references in your codebase',
        'View in Marketplace',
    );
    if (selection === 'View in Marketplace') {
        vscode.commands
            .executeCommand('extension.open', 'timliu.references')
            .then(undefined, () => {
                vscode.env.openExternal(
                    vscode.Uri.parse(
                        'https://marketplace.visualstudio.com/items?itemName=timliu.references',
                    ),
                );
            });
    }
}

function registerCommands(
    context: vscode.ExtensionContext,
    treeDataProvider: ReferencesProvider,
    treeView: vscode.TreeView<Reference>,
) {
    const commands = [
        {
            command: 'references.showInfo',
            callback: handleShowInfo,
        },
        {
            command: 'references.listReferences',
            callback: () => handleListReferences(treeDataProvider, treeView),
        },
        {
            command: 'references.addItem',
            callback: () => showAddItemInput(treeDataProvider, treeView),
        },
        {
            command: 'references.removeItem',
            callback: (elem: Reference) => treeDataProvider.removeSymbol(elem),
        },
        {
            command: 'references.clearItems',
            callback: () => treeDataProvider.purge(),
        },
    ];

    commands.forEach(({ command, callback }) => {
        const disposable = vscode.commands.registerCommand(command, callback);
        context.subscriptions.push(disposable);
    });
}

function registerCompletionProvider(context: vscode.ExtensionContext) {
    const selector = [
        { scheme: 'file', language: 'c' },
        { scheme: 'file', language: 'cpp' },
    ];
    const provider = new ReferencesCompletionItemProvider();
    const disposable = vscode.languages.registerCompletionItemProvider(selector, provider);
    context.subscriptions.push(disposable);
}

function registerDocumentSymbolProvider(context: vscode.ExtensionContext) {
    const selector = [
        { scheme: 'file', language: 'c' },
        { scheme: 'file', language: 'cpp' },
    ];
    const provider = new ReferencesDocumentSymbolProvider();
    const disposable = vscode.languages.registerDocumentSymbolProvider(selector, provider);
    context.subscriptions.push(disposable);
}

async function showAddItemInput(
    treeDataProvider: ReferencesProvider,
    treeView: vscode.TreeView<Reference>,
) {
    const option: vscode.InputBoxOptions = {
        title: 'Search reference of',
        prompt: 'support regex',
        ignoreFocusOut: true,
    };

    const input = await vscode.window.showInputBox(option);
    if (!input) {
        return;
    }

    const symbol = treeDataProvider.appendSymbol(input);
    if (symbol) {
        treeView.reveal(symbol);
    }
    vscode.commands.executeCommand('references.references.focus');
}

function handleListReferences(
    treeDataProvider: ReferencesProvider,
    treeView: vscode.TreeView<Reference>,
) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        showAddItemInput(treeDataProvider, treeView);
        return;
    }

    const selection = editor.selection;
    const word =
        editor.document.getText(selection) ||
        editor.document.getText(
            editor.document.getWordRangeAtPosition(selection.active) || selection,
        );

    if (word) {
        const symbol = treeDataProvider.appendSymbol(word);
        if (symbol) {
            treeView.reveal(symbol);
        }
        vscode.commands.executeCommand('references.references.focus');
    } else {
        showAddItemInput(treeDataProvider, treeView);
    }
}

export function deactivate() {}
