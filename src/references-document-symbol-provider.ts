import * as vscode from 'vscode';
import * as p from 'child_process';
import { ctags, parseCtagsOutput } from './references-utils';
// import { getGtagsFileSymbols } from './references-utils';

const symbolMap: Record<string, vscode.SymbolKind> = {
    function: vscode.SymbolKind.Function,
    variable: vscode.SymbolKind.Variable,
    enum: vscode.SymbolKind.Enum,
    member: vscode.SymbolKind.EnumMember,
    struct: vscode.SymbolKind.Struct,
    typedef: vscode.SymbolKind.Constant,
    macro: vscode.SymbolKind.Constant,
};

export class ReferencesDocumentSymbolProvider implements vscode.DocumentSymbolProvider {
    provideDocumentSymbols(
        document: vscode.TextDocument,
        token: vscode.CancellationToken,
    ): vscode.ProviderResult<vscode.DocumentSymbol[]> {
        const symbols: vscode.DocumentSymbol[] = [];
        const cwd = vscode.workspace.workspaceFolders?.[0].uri.path;
        if (!cwd) return [];

        const ctagsOut = p.execSync(`${ctags()} --fields=+neK -o - --sort=no ${document.fileName}`, {
            cwd,
        });
        const ctagsSymbol = parseCtagsOutput(ctagsOut);
        ctagsSymbol.forEach((item) => {
            console.log(item)
            if ('struct' in item) {
                return
            }
            let start = item.content.indexOf(item.name);
            if (start < 0) {
                start = 0;
            }
            const end = start + item.name.length;
            const symbolRange = new vscode.Range(
                new vscode.Position(item.line - 1, start),
                new vscode.Position(item.line - 1, end),
            );

            const symbol = new vscode.DocumentSymbol(
                item.name,
                item.content,
                symbolMap[item.kind],
                symbolRange,
                symbolRange,
            );
            symbols.push(symbol);
        });

        // const data = getGtagsFileSymbols(document.fileName);
        // data.forEach((item) => {
        //     console.log(item);
        //     let start = item.content.indexOf(item.tag);
        //     if (start < 0) {
        //         start = 0;
        //     }
        //     const end = start + item.tag.length;
        //     const symbolRange = new vscode.Range(
        //         new vscode.Position(item.line - 1, start),
        //         new vscode.Position(item.line - 1, end),
        //     );
        //     const symbol = new vscode.DocumentSymbol(
        //         item.tag,
        //         item.content,
        //         symbolMap[item.kind],
        //         symbolRange,
        //         symbolRange,
        //     );
        //     symbols.push(symbol);
        // });
        return symbols;
    }
}
