// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';


import * as fs from 'fs';
import * as path from 'path';
import * as p from 'child_process';


export class ReferencesCompletionItemProvider implements vscode.CompletionItemProvider {
    private list: vscode.CompletionItem[] = [];

    constructor() {
        const cwd = vscode.workspace.workspaceFolders?.[0].uri.path
        const child = p.spawn(global(), ['-cT'], {cwd: cwd})
        let cache: string = '';
        let stderr: string = '';
        child.stdout.on('data', (data: Buffer) => {
            let concat: string = cache + data.toString();
            let last = concat.lastIndexOf('\n')
            this.list = this.list.concat(concat.substring(0, last).split('\n').map((s) => new vscode.CompletionItem(s)))
            cache = concat.substring(last+1)
        })
        child.stderr.on('data', (data: Buffer) => {
            stderr += data.toString()
        });
        child.on('close', (code) => {
            if (code != 0) {
                vscode.window.showInformationMessage(`Error on generate completion data, code ${code}.\n\n${stderr}`);
            } else if (cache) {
                this.list.push(new vscode.CompletionItem(cache));
            }
        });
    }

    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position,
                                  token: vscode.CancellationToken, context: vscode.CompletionContext)
                                  : vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        return this.list
	}
}

export class ReferencesProvider implements vscode.TreeDataProvider<Reference> {
    constructor(private workspaceRoot: string) {}
    private symbols: Reference[] = [];
    private _onDidChangeTreeData: vscode.EventEmitter<Reference | undefined | null | void> = new vscode.EventEmitter<Reference | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<Reference | undefined | null | void> = this._onDidChangeTreeData.event;

    getTreeItem(element: Reference): vscode.TreeItem {
        if (element.line == 0 || element.content == '') { return element; }
        let start: number = element.content.indexOf(element.tag);
        const end: number = start + element.tag.length;
        if (start < 0) {
            start = 0;
            console.warn("References Warning: gtags might be out of date, run `global -u` to update gtags.");
        }
        const range: vscode.Range = new vscode.Range(
            new vscode.Position(element.line-1, start),
            new vscode.Position(element.line-1, end)
        )
        element.command = {
			command: 'vscode.open',
			title: 'Open Call',
			arguments: [
				vscode.Uri.file(this.workspaceRoot + "/"+ element.filename),
				<vscode.TextDocumentShowOptions>{
					selection: range,
					preserveFocus: true
				}
			]
		};
        return element;
    }

    getParent(element: Reference): vscode.ProviderResult<Reference>
    {
        return undefined;
    }

    getChildren(element?: Reference): Thenable<Reference[]> {
        if (!this.workspaceRoot) {
            vscode.window.showInformationMessage('No Reference in empty workspace');
            return Promise.resolve([]);
        }

        if (element) {
            return Promise.resolve(this.getReferences(element));
        } else {
            if (this.symbols.length > 0) {
                return Promise.resolve(this.symbols);
            }
            return Promise.resolve([]);
        }
    }

    getReferences(symbol: string|Reference, isRoot?: boolean): Reference[] {
        let refs: Reference[] = [];
        let symbolTag = ''
        if (symbol instanceof Reference) {
            symbolTag = symbol.label;
        } else {
            symbolTag = symbol
        }
        const hasRegrex: boolean = symbolTag.includes('*') || symbolTag.includes('?');

        /*
            let output = p.execSync('references '+symbolTag, {
                cwd: this.workspaceRoot,
            })
            const obj = JSON.parse(output.toString());
        */
        const obj = getGtagsReferences(symbolTag);
        if (isRoot && (obj.filter(x => (x.type == 'definition')).length == 0)) {
            return [new Reference(
                symbolTag,
                '',
                0,
                'symbol',
                symbolTag,
                '',
                true,
                true,
                'macro',
            )]
        }
        obj.forEach((elem: any) => {
            if (isRoot && elem.type != 'definition') {
                return
            }
            if (symbol instanceof Reference && symbol.filename == elem.filename && symbol.line == elem.line) {
                return
            }

            let expanded = isRoot || false;
            if (hasRegrex || refs.length > 0) {
                expanded = false;
            }
            let label: string = '';
            if (elem.function == undefined) {
                label = elem.tag
            } else if (elem.kind == 'enum' || elem.kind == 'struct') {
                label = elem.tag
            } else {
                label = elem.function
            }
            let ref = new Reference(
                label,
                elem.filename,
                elem.line,
                elem.type,
                elem.tag,
                elem.content,
                isRoot || false,
                expanded,
                elem.kind,
            );
            refs.push(ref);
        });
        return refs
    }

    appendSymbol(symbol: string) {
        let newSymbol = this.getReferences(symbol, true);
        if (newSymbol.length == 0) {
            vscode.window.showInformationMessage(`Not find references of "${symbol}"`);
        } else {
            this.symbols = newSymbol.concat(this.symbols);
            this.refresh();
            return newSymbol[0];
        }
    }

    removeSymbol(ref: Reference) {
        this.symbols = this.symbols.filter(item => (item.filename !== ref.filename || item.line !== ref.line));
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
        super(label, vscode.TreeItemCollapsibleState.None);
        let appendType = (this.type && this.type != 'undefined') ? ` [${this.type}]` : '';
        if (line != 0) {
            this.description = path.basename(filename) + ":" + line;
            this.tooltip = `${this.label}${appendType}\n\n`+
                `${this.filename}\n${this.line}:${this.content.trim()}\n`;
        }

        if (type == undefined || type == 'other') {
            this.collapsibleState = vscode.TreeItemCollapsibleState.None;
        } else if (expanded) {
            this.collapsibleState = vscode.TreeItemCollapsibleState.Expanded;
        } else {
            this.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
        }

        if (isRoot) {
            this.contextValue = "treeItemCouldBeRemoved";
        }

        let color = 'titleBar.inactiveForeground';
        if (type == 'definition') {
            color = 'symbolIcon.methodForeground';
        } else if (type == 'referencedBy') {
            color = 'symbolIcon.fieldForeground'
        }

        let iconMap: any = {
            function: 'symbol-method',
            variable: 'symbol-variable',
            enum: 'symbol-enum',
            member: 'symbol-enum-member',
            struct: 'symbol-struct',
            typedef: 'symbol-interface',
            macro: 'symbol-constant',
        }
        let icon = 'symbol-method';
        if (kind in iconMap) {
            icon = iconMap[kind]
        } else if (kind == '') {
        } else {
            // console.log(">> undefined kind >>>", kind);
        }

        this.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color))
    }
}

function global(): string {
    return vscode.workspace.getConfiguration().get<string>('references.globalExecutable') || 'global';
}

function ctags(): string {
    return vscode.workspace.getConfiguration().get<string>('references.ctagsExecutable') || 'ctags';
}

function isCompletion(): boolean {
    return vscode.workspace.getConfiguration().get<string>('references.completion') == 'Enabled';
}

function preCheck() {
    p.exec(`${global()} --version`, (error, stdout, stderr) => {
        const err = `GNU Global is required to this extension.`;
        if (error) {
            vscode.window.showInformationMessage(err+' '+stderr);
        }
    })

    p.exec(`${ctags()} --version`, (error, stdout, stderr) => {
        const err = `universal-ctags is required to this extension.`;
        if (error) {
            vscode.window.showInformationMessage(err+' '+stderr);
        } else if (!stdout.match(/Universal Ctags/)) {
                vscode.window.showInformationMessage(err);
        } else {
            /*
            p.exec(`${ctags()} --list-features`, (error, stdout, stderr) => {
                if (error || !stdout.match(/\njson\s/)) {
                    const err = `universal-ctags doesn't supports json format output, please reinstall ctags.`;
                    vscode.window.showInformationMessage(err);
                }
            })
            */
        }
    })

    const cwd = vscode.workspace.workspaceFolders?.[0].uri.path
    if (cwd == undefined) {
        return []
    }
    fs.stat(path.join(cwd, 'GTAGS'), function(err, stat) {
        if (err?.code === 'ENOENT') {
            const err = 'GTAGS is not generated, use "gtags" to generate tag files for global.'
            vscode.window.showInformationMessage(err);
        } else if (err != null) {
            p.exec(`${global()} -u`, {cwd: cwd})
        }
    });
}

function getGtagsReferences(symbol: string): any[]{
    const cwd = vscode.workspace.workspaceFolders?.[0].uri.path
    if (cwd == undefined) {
        return []
    }

    let reGlobal = /(\S+)\s+(\d+)\s+(\S+) (.*)/g
    let output = p.execSync(`${global()} -x ${symbol}`, {cwd: cwd});
    let array = [...output.toString().matchAll(reGlobal)]
    let data = array.map((x) => ({
        tag: x[1],
        line: x[2],
        filename: x[3],
        content: x[4],
        type: 'definition',
        function: undefined,
        kind: '',
        extra: undefined,
    }))

    if (data.length > 0) {
        output = p.execSync(`${global()} -rx ${symbol}`, {cwd: cwd});
        array = [...output.toString().matchAll(reGlobal)]
        data = data.concat(array.map((x) => ({
            tag: x[1],
            line: x[2],
            filename: x[3],
            content: x[4],
            type: 'referencedBy',
            function: undefined,
            kind: '',
            extra: undefined,
        })))
    } else {
        output = p.execSync(`${global()} -sx ${symbol}`, {cwd: cwd});
        array = [...output.toString().matchAll(reGlobal)]
        data = data.concat(array.map((x) => ({
            tag: x[1],
            line: x[2],
            filename: x[3],
            content: x[4],
            type: 'referencedBy',
            function: undefined,
            kind: '',
            extra: undefined,
        })))
    }

    let fileMap: any = {}
    data.forEach((x) => {
        fileMap[x.filename] = null
        if (!(x.filename in fileMap)) {
            return
        }
    
        /*
        output = p.execSync(`${ctags()} --fields=+neK -o - --sort=no --output-format=json ${x.filename}`, {cwd: cwd});
        let symbols: any = []
        let ctagsResultArray = output.toString().split('\n')
        ctagsResultArray.forEach((y, idx) => {
            try {
                let obj = JSON.parse(y)
                if (obj) {
                    if (obj.end == undefined) {
                        obj.end = obj.line
                    }
                    symbols.push(obj)
                }
            } catch {
            }
        })
        */

        const reCtags = /(\S+)\t([^\t]+)\t\/\^(.*)\$?\/;"\t(\S+)\t?(.*)/g
        output = p.execSync(`${ctags()} --fields=+neK -o - --sort=no ${x.filename}`, {cwd: cwd});
        let symbols: any = [];
        let ctagsResults = [...output.toString().matchAll(reCtags)]
        ctagsResults.map(item => {
            let obj: any = {
                name: item[1],
                path: item[2],
                content: item[3],
                kind: item[4],
            };
            item[5].split('\t').forEach((x) => {
                let colon = x.indexOf(':');
                if (colon > 0) {
                    let k = x.substring(0, colon);
                    let v = x.substring(colon+1);
                    if (k == 'line' || k == 'end') {
                        obj[k] = parseInt(v);
                    } else {
                        obj[k] = v;
                    }
                }
            })
            if (obj.end == undefined) {
                obj.end = obj.line
            }
            symbols.push(obj)
        })

        fileMap[x.filename] = symbols
    })

    for (let i = 0; i < data.length; i++) {
        let filename = data[i].filename
        let line = data[i].line

        if (!(filename in fileMap)) {
            continue
        }
        let symbols = fileMap[filename];
        for (let j = 0; j < symbols.length; j++) {
            if (symbols[j].line > line) {
                break;
            } else if (symbols[j].line <= line && symbols[j].end >= line) {
                data[i].function = symbols[j].name
                data[i].kind = symbols[j].kind
                // data[i].extra = symbols[j]
                break;
            }
        }
        if (data[i].type == 'definition') {
        } else if (data[i].tag == data[i].function) {
            data[i].type = 'definition';
        } else if (data[i].function == undefined) {
            data[i].type = 'others';
        }
    }
    return data
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
    preCheck();

    let treeDataProvider = new ReferencesProvider(vscode.workspace.workspaceFolders?.[0].uri.path || '')

    const treeView = vscode.window.createTreeView('references.references', {
		treeDataProvider: treeDataProvider,
	});

    const addItemInput = function() {
        const option: vscode.InputBoxOptions = {title: 'Search reference of', prompt: "support regrex", ignoreFocusOut: true};
        vscode.window.showInputBox(option).then((s) => {
            if (s == undefined) {
                return
            }
            const symbol = treeDataProvider.appendSymbol(s);
            if (symbol) {
                treeView.reveal(symbol);
            }
            vscode.commands.executeCommand('references.references.focus')
        });
    }


	let disposable = vscode.commands.registerCommand('references.showInfo', () => {
        vscode.window.showInformationMessage('References')
	});
	context.subscriptions.push(disposable);

    let disposableGcw = vscode.commands.registerCommand('references.listReferences', function () {
        let editor = vscode.window.activeTextEditor;
        let word = '';

        if (editor) {
            let selection = editor.selection;
            word = editor.document.getText(selection);
            if (!word) {
                let wordRange = editor.document.getWordRangeAtPosition(selection.active);
                if (wordRange) {
                    word = editor.document.getText(wordRange);
                }
            }
        }

        if (word) {
            //vscode.window.showInformationMessage("Current word: " + word);
            const symbol = treeDataProvider.appendSymbol(word);
            if (symbol) {
                treeView.reveal(symbol);
            }
            vscode.commands.executeCommand('references.references.focus')
        } else {
            addItemInput();
        }

    });
    context.subscriptions.push(disposableGcw);

    let disposableAim = vscode.commands.registerCommand('references.addItem', function () {
        addItemInput();
    });
    context.subscriptions.push(disposableAim);

    let disposableRim = vscode.commands.registerCommand('references.removeItem', (elem) => {
        treeDataProvider.removeSymbol(elem)
    });
    context.subscriptions.push(disposableRim);

    let disposablePurfe = vscode.commands.registerCommand('references.clearItems', () => {
        treeDataProvider.purge()
    });
    context.subscriptions.push(disposablePurfe);

    if (isCompletion()) {
        const completionSelector = [{ scheme: 'file', language: 'c' }, { scheme: 'file', language: 'cpp' }];
        const completionProvider = new ReferencesCompletionItemProvider();
        let disposableComp = vscode.languages.registerCompletionItemProvider(completionSelector, completionProvider);
        context.subscriptions.push(disposableComp);
    }
}

// This method is called when your extension is deactivated
export function deactivate() {
    // console.clear();
}
