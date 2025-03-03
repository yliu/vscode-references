import * as vscode from 'vscode';
import * as path from 'path';
import { Reference } from './references-treeitem'
import { getDefinitions } from './references-utils';


export class ReferencesDefinitionProvider implements vscode.DefinitionProvider {
    constructor() {}

    provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition> {
        return new Promise<vscode.Location[]>((resolve, reject) => {
            const cwd = vscode.workspace.workspaceFolders?.[0].uri.path;
            if (!cwd) return [];
            
            const symbol = document.getText(document.getWordRangeAtPosition(position));
            const reGlobal = /(\S+)\s+(\d+)\s+(\S+) (.*)/g;
            const data = getDefinitions(symbol, cwd, reGlobal);
            const locations = data.map(item => {
                const ref = new Reference(item.tag, item.filename, item.line, item.type, item.tag, item.content, false, false, item.kind);
                return new vscode.Location(
                    vscode.Uri.file(path.join(cwd, item.filename)),
                    ref.calculateRange()
                );
            });

            try {
                return resolve(locations);
            } catch (e) {
                return reject(e);
            }
        });
    }
}

