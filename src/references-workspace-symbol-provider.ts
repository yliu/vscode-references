import * as vscode from 'vscode';
import * as p from 'child_process';
import { global, ctags, parseCtagsOutput } from './references-utils';
import { getGtagsQuerySymbols } from './references-utils';
import * as path from 'path';

const symbolMap: Record<string, vscode.SymbolKind> = {
    function: vscode.SymbolKind.Function,
    variable: vscode.SymbolKind.Variable,
    enum: vscode.SymbolKind.Enum,
    member: vscode.SymbolKind.EnumMember,
    struct: vscode.SymbolKind.Struct,
    typedef: vscode.SymbolKind.Constant,
    macro: vscode.SymbolKind.Constant,
    '': vscode.SymbolKind.String,
};

export class ReferencesWorkspaceSymbolProvider implements vscode.WorkspaceSymbolProvider {
    constructor() {}

    async provideWorkspaceSymbols(query: string, token: vscode.CancellationToken): Promise<vscode.SymbolInformation[]> {
        const cwd = vscode.workspace.workspaceFolders?.[0].uri.path;
        if (!cwd) return [];

        try {
            if (query.length < 2) return [];

            return new Promise((resolve, reject) => {
                const symbols = getGtagsQuerySymbols(query).map((item) => {
                    const linestart = Math.max(item.content.indexOf(item.tag), 0);
                    return new vscode.SymbolInformation(
                        item.tag,
                        symbolMap[item.kind],
                        `line ${item.line}`,
                        new vscode.Location(
                            vscode.Uri.file(path.join(cwd, item.filename)),
                            new vscode.Position(parseInt(item.line) - 1, linestart)
                        )
                    )
                });
                resolve(symbols)
            });
        } catch (error) {
            console.error('Error in provideWorkspaceSymbols:', error);
            return [];
        }
    }
}