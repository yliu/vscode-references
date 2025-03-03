import * as vscode from 'vscode';
import * as path from 'path';
import { Reference } from './references-treeitem';
import { getGtagsReferences } from './references-utils'


// Provides the tree view of references
export class ReferencesProvider implements vscode.TreeDataProvider<Reference> {
    private symbols: Reference[] = [];
    private _onDidChangeTreeData = new vscode.EventEmitter<Reference | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    constructor(private workspaceRoot: string) {}

    getTreeItem(element: Reference): vscode.TreeItem {
        if (element.line === 0 || !element.content) {
            return element;
        }

        element.command = this.createOpenCommand(element, element.calculateRange());
        return element;
    }

    private createOpenCommand(element: Reference, range: vscode.Range): vscode.Command {
        return {
            command: 'vscode.open',
            title: 'Open Call',
            arguments: [
                vscode.Uri.file(path.join(this.workspaceRoot, element.filename)),
                { selection: range, preserveFocus: true } as vscode.TextDocumentShowOptions
            ]
        };
    }

    getParent(): vscode.ProviderResult<Reference> {
        return undefined;
    }

    getChildren(element?: Reference): Thenable<Reference[]> {
        if (!this.workspaceRoot) {
            vscode.window.showInformationMessage('No Reference in empty workspace');
            return Promise.resolve([]);
        }

        if (element) {
            return Promise.resolve(this.getReferences(element));
        }
        
        return Promise.resolve(this.symbols);
    }

    getReferences(symbol: string | Reference, isRoot?: boolean): Reference[] {
        const symbolTag = symbol instanceof Reference ? symbol.label : symbol;
        const hasRegex = symbolTag.includes('*') || symbolTag.includes('?');

        const references = getGtagsReferences(symbolTag);
        
        if (isRoot && !references.some(x => x.type === 'definition')) {
            return [new Reference(
                symbolTag,
                '',
                0,
                'symbol',
                symbolTag,
                '',
                true,
                true,
                'macro'
            )];
        }

        return references
            .filter(elem => {
                if (isRoot && elem.type !== 'definition') return false;
                if (symbol instanceof Reference && 
                    symbol.filename === elem.filename && 
                    symbol.line === elem.line) return false;
                return true;
            })
            .map((elem, index, array) => {
                const expanded = isRoot && !hasRegex && array.length === 1 || false;
                const label = this.determineLabel(elem);
                
                return new Reference(
                    label,
                    elem.filename,
                    elem.line,
                    elem.type,
                    elem.tag,
                    elem.content,
                    isRoot || false,
                    expanded,
                    elem.kind
                );
            });
    }

    private determineLabel(elem: any): string {
        if (!elem.function) return elem.tag;
        if (elem.kind === 'enum' || elem.kind === 'struct') return elem.tag;
        return elem.function;
    }

    appendSymbol(symbol: string): Reference | undefined {
        const newSymbols = this.getReferences(symbol, true);
        if (newSymbols.length === 0) {
            vscode.window.showInformationMessage(`No references found for "${symbol}"`);
            return undefined;
        }
        
        this.symbols = newSymbols.concat(this.symbols);
        this.refresh();
        return newSymbols[0];
    }

    removeSymbol(ref: Reference) {
        this.symbols = this.symbols.filter(item => 
            item.filename !== ref.filename || item.line !== ref.line
        );
        this.refresh();
    }

    purge() {
        this.symbols = [];
        this.refresh();
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }
}
