import * as vscode from 'vscode';
import * as path from 'path';


// Represents a single reference item in the tree
export class Reference extends vscode.TreeItem {
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
