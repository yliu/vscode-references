import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as p from 'child_process';

// Provides auto-completion items from GNU Global tags
class ReferencesCompletionItemProvider implements vscode.CompletionItemProvider {
    private completionItems: vscode.CompletionItem[] = [];

    constructor() {
        this.initializeCompletionItems();
    }

    private initializeCompletionItems() {
        const cwd = vscode.workspace.workspaceFolders?.[0].uri.path;
        const child = p.spawn(global(), ['-cT'], {cwd});
        
        let buffer = '';
        let errors = '';

        child.stdout.on('data', (data: Buffer) => {
            const text = buffer + data.toString();
            const lastNewline = text.lastIndexOf('\n');
            
            this.completionItems = this.completionItems.concat(
                text.substring(0, lastNewline)
                    .split('\n')
                    .map(s => new vscode.CompletionItem(s))
            );
            
            buffer = text.substring(lastNewline + 1);
        });

        child.stderr.on('data', (data: Buffer) => {
            errors += data.toString();
        });

        child.on('close', (code) => {
            if (code !== 0) {
                vscode.window.showInformationMessage(
                    `Error generating completion data (code ${code}).\n\n${errors}`
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
        context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        return this.completionItems;
    }
}

class ReferencesDefinitionProvider implements vscode.DefinitionProvider {
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


// Provides the tree view of references
class ReferencesProvider implements vscode.TreeDataProvider<Reference> {
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

// Represents a single reference item in the tree
class Reference extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly filename: string,
        public readonly line: number,
        private type: string,
        public readonly tag: string,
        public readonly content: string,
        private isRoot: boolean,
        private expanded: boolean,
        private kind: string,
    ) {
        super(label);
        this.setupTreeItem();
    }

    private setupTreeItem() {
        this.setupDescription();
        this.setupCollapsibleState();
        this.setupContextValue();
        this.setupIcon();
    }

    private setupDescription() {
        if (this.line !== 0) {
            const appendType = this.type && this.type !== 'undefined' ? ` [${this.type}]` : '';
            this.description = `${path.basename(this.filename)}:${this.line}`;
            this.tooltip = `${this.label}${appendType}\n\n${this.filename}\n${this.line}:${this.content.trim()}\n`;
        }
    }

    private setupCollapsibleState() {
        if (this.type === undefined || this.type === 'other') {
            this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        } else if (this.expanded) {
            this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        } else {
            this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        }
    }

    private setupContextValue() {
        if (this.isRoot) {
            this.contextValue = "treeItemCouldBeRemoved";
        }
    }

    private setupIcon() {
        const iconMap: Record<string, string> = {
            function: 'symbol-method',
            variable: 'symbol-variable',
            enum: 'symbol-enum',
            member: 'symbol-enum-member',
            struct: 'symbol-struct',
            typedef: 'symbol-interface',
            macro: 'symbol-constant',
        };

        const color = this.getIconColor();
        const icon = this.kind in iconMap ? iconMap[this.kind] : 'symbol-method';
        
        this.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
    }

    private getIconColor(): string {
        if (this.type === 'definition') return 'symbolIcon.methodForeground';
        if (this.type === 'referencedBy') return 'symbolIcon.fieldForeground';
        return 'titleBar.inactiveForeground';
    }

    calculateRange(): vscode.Range {
        let start = this.content.indexOf(this.tag);
        if (start < 0) {
            start = 0;
            console.warn("References Warning: gtags might be out of date, run `global -u` to update gtags.");
        }
        const end = start + this.tag.length;

        return new vscode.Range(
            new vscode.Position(this.line - 1, start),
            new vscode.Position(this.line - 1, end)
        );
    }
}

// Utility functions
function global(): string {
    return vscode.workspace.getConfiguration().get<string>('references.globalExecutable') || 'global';
}

function ctags(): string {
    return vscode.workspace.getConfiguration().get<string>('references.ctagsExecutable') || 'ctags';
}

function isCompletion(): boolean {
    return vscode.workspace.getConfiguration().get<boolean>('references.completion') ?? false;
}

function preCheck() {
    checkGlobalInstallation();
    checkCtagsInstallation();
    checkGtagsFile();
}

function checkGlobalInstallation() {
    p.exec(`${global()} --version`, (error, stdout, stderr) => {
        if (error) {
            showNotification('GNU Global is required for this extension. ' + stderr);
        }
    });
}

function checkCtagsInstallation() {
    p.exec(`${ctags()} --version`, (error, stdout, stderr) => {
        if (error) {
            showNotification('universal-ctags is required for this extension. ' + stderr);
        } else if (!stdout.match(/Universal Ctags/)) {
            showNotification('universal-ctags is required for this extension.');
        }
    });
}

function checkGtagsFile() {
    const cwd = vscode.workspace.workspaceFolders?.[0].uri.path;
    if (!cwd) return;

    fs.stat(path.join(cwd, 'GTAGS'), (err, stat) => {
        if (err?.code === 'ENOENT') {
            showNotification('GTAGS is not generated, use "gtags" to generate tag files for global.')
        } else if (err) {
            p.exec(`${global()} -u`, {cwd});
        }
    });
}

function showNotification(message: string) {
    if (vscode.workspace.getConfiguration().get<boolean>('references.notShowWarnings')) {
        return;
    }
    const close = 'Close';
    const turnOff = 'Turn Off Further Warnings';
    vscode.window.showInformationMessage(
        message,
        close,
        turnOff,
    ).then(selection => {
        if (selection === turnOff) {
            vscode.workspace.getConfiguration().update('references.notShowWarnings', true, true);
        }
    });
}

function getGtagsReferences(symbol: string): any[] {
    const cwd = vscode.workspace.workspaceFolders?.[0].uri.path;
    if (!cwd) return [];

    const reGlobal = /(\S+)\s+(\d+)\s+(\S+) (.*)/g;
    let data = getDefinitions(symbol, cwd, reGlobal);

    if (data.length > 0) {
        data = data.concat(getReferences(symbol, cwd, reGlobal, 'rx'));
    } else {
        data = data.concat(getReferences(symbol, cwd, reGlobal, 'sx'));
    }

    enrichDataWithCtagsInfo(data, cwd);
    return data;
}

function getDefinitions(symbol: string, cwd: string, regex: RegExp): any[] {
    const output = p.execSync(`${global()} -x ${symbol}`, {cwd});
    return parseGlobalOutput(output, regex, 'definition');
}

function getReferences(symbol: string, cwd: string, regex: RegExp, flag: string): any[] {
    const output = p.execSync(`${global()} -${flag} ${symbol}`, {cwd});
    return parseGlobalOutput(output, regex, 'referencedBy');
}

function parseGlobalOutput(output: Buffer, regex: RegExp, type: string): any[] {
    return [...output.toString().matchAll(regex)].map(x => ({
        tag: x[1],
        line: x[2],
        filename: x[3],
        content: x[4],
        type,
        function: undefined,
        kind: '',
        extra: undefined
    }));
}

function enrichDataWithCtagsInfo(data: any[], cwd: string) {
    const fileMap = buildFileSymbolMap(data, cwd);
    
    for (const item of data) {
        const symbols = fileMap[item.filename];
        if (!symbols) continue;

        const matchingSymbol = symbols.find(s => 
            s.line <= item.line && s.end >= item.line
        );

        if (matchingSymbol) {
            item.function = matchingSymbol.name;
            item.kind = matchingSymbol.kind;
        }

        updateItemType(item);
    }
}

function buildFileSymbolMap(data: any[], cwd: string): Record<string, any[]> {
    const fileMap: Record<string, any[]> = {};
    const processedFiles = new Set<string>();

    for (const item of data) {
        if (processedFiles.has(item.filename)) continue;
        processedFiles.add(item.filename);

        const output = p.execSync(
            `${ctags()} --fields=+neK -o - --sort=no ${item.filename}`,
            {cwd}
        );
        fileMap[item.filename] = parseCtagsOutput(output);
    }

    return fileMap;
}

function parseCtagsOutput(output: Buffer): any[] {
    const reCtags = /(\S+)\t([^\t]+)\t\/\^(.*)\$?\/;"\t(\S+)\t?(.*)/g;
    return [...output.toString().matchAll(reCtags)].map(item => {
        const obj: any = {
            name: item[1],
            path: item[2],
            content: item[3],
            kind: item[4]
        };

        item[5].split('\t').forEach(x => {
            const [key, value] = x.split(':');
            if (key && value) {
                obj[key] = key === 'line' || key === 'end' ? parseInt(value) : value;
            }
        });

        if (obj.end === undefined) {
            obj.end = obj.line;
        }

        return obj;
    });
}

function updateItemType(item: any) {
    if (item.type === 'definition') return;
    if (item.tag === item.function) {
        item.type = 'definition';
    } else if (item.function === undefined) {
        item.type = 'others';
    }
}

// Extension activation and deactivation
export function activate(context: vscode.ExtensionContext) {
    preCheck();

    const workspacePath = vscode.workspace.workspaceFolders?.[0].uri.path || '';
    const treeDataProvider = new ReferencesProvider(workspacePath);

    const treeView = vscode.window.createTreeView('references.references', {
        treeDataProvider
    });

    const definitionProvider = new ReferencesDefinitionProvider();
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            { scheme: 'file' },
            definitionProvider
        )
    );

    registerCommands(context, treeDataProvider, treeView);

    if (isCompletion()) {
        registerCompletionProvider(context);
    }
}

async function handleShowInfo() {
    const selection = await vscode.window.showInformationMessage(
        'References - Search and track references in your codebase',
        'View in Marketplace'
    );
    if (selection === 'View in Marketplace') {
        vscode.commands.executeCommand('extension.open', 'timliu.references').then(undefined, () => {
            vscode.env.openExternal(vscode.Uri.parse('https://marketplace.visualstudio.com/items?itemName=timliu.references'));
        });
    }
}

function registerCommands(
    context: vscode.ExtensionContext,
    treeDataProvider: ReferencesProvider,
    treeView: vscode.TreeView<Reference>
) {
    const commands = [
        {
            command: 'references.showInfo',
            callback: handleShowInfo
        },
        {
            command: 'references.listReferences',
            callback: () => handleListReferences(treeDataProvider, treeView)
        },
        {
            command: 'references.addItem',
            callback: () => showAddItemInput(treeDataProvider, treeView)
        },
        {
            command: 'references.removeItem',
            callback: (elem: Reference) => treeDataProvider.removeSymbol(elem)
        },
        {
            command: 'references.clearItems',
            callback: () => treeDataProvider.purge()
        }
    ];

    commands.forEach(({command, callback}) => {
        const disposable = vscode.commands.registerCommand(command, callback);
        context.subscriptions.push(disposable);
    });
}

function registerCompletionProvider(context: vscode.ExtensionContext) {
    const selector = [
        { scheme: 'file', language: 'c' },
        { scheme: 'file', language: 'cpp' }
    ];
    const provider = new ReferencesCompletionItemProvider();
    const disposable = vscode.languages.registerCompletionItemProvider(selector, provider);
    context.subscriptions.push(disposable);
}

async function showAddItemInput(
    treeDataProvider: ReferencesProvider,
    treeView: vscode.TreeView<Reference>
) {
    const option: vscode.InputBoxOptions = {
        title: 'Search reference of',
        prompt: "support regex",
        ignoreFocusOut: true
    };

    const input = await vscode.window.showInputBox(option);
    if (!input) return;

    const symbol = treeDataProvider.appendSymbol(input);
    if (symbol) {
        treeView.reveal(symbol);
    }
    vscode.commands.executeCommand('references.references.focus');
}

function handleListReferences(
    treeDataProvider: ReferencesProvider,
    treeView: vscode.TreeView<Reference>
) {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        showAddItemInput(treeDataProvider, treeView);
        return;
    }

    const selection = editor.selection;
    const word = editor.document.getText(selection) || 
                 editor.document.getText(editor.document.getWordRangeAtPosition(selection.active) || selection);

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
