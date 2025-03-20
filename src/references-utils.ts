import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as p from 'child_process';

// Utility functions
export function global(): string {
    return (
        vscode.workspace.getConfiguration().get<string>('references.globalExecutable') || 'global'
    );
}

export function ctags(): string {
    return vscode.workspace.getConfiguration().get<string>('references.ctagsExecutable') || 'ctags';
}

export function isCompletion(): boolean {
    return vscode.workspace.getConfiguration().get<boolean>('references.completion') ?? false;
}

export function preCheck() {
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
            showNotification(
                'GTAGS is not generated, use "gtags" to generate tag files for global.',
            );
        } else if (err) {
            p.exec(`${global()} -u`, { cwd });
        }
    });
}

function showNotification(message: string) {
    if (vscode.workspace.getConfiguration().get<boolean>('references.notShowWarnings')) {
        return;
    }
    const close = 'Close';
    const turnOff = 'Turn Off Further Warnings';
    vscode.window.showInformationMessage(message, close, turnOff).then((selection) => {
        if (selection === turnOff) {
            vscode.workspace.getConfiguration().update('references.notShowWarnings', true, true);
        }
    });
}

export function getGtagsReferences(symbol: string): any[] {
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

export function getGtagsFileSymbols(filename: string): any[] {
    const cwd = vscode.workspace.workspaceFolders?.[0].uri.path;
    if (!cwd) return [];

    const reGlobal = /(\S+)\s+(\d+)\s+(\S+) (.*)/g;
    const output = p.execSync(`${global()} -xf ${filename}`, { cwd });
    const data = parseGlobalOutput(output, reGlobal, 'symbols');

    enrichDataWithCtagsInfo(data, cwd);
    return data;
}

export function getGtagsQuerySymbols(query: string): any[] {
    const cwd = vscode.workspace.workspaceFolders?.[0].uri.path;
    if (!cwd) return [];

    const queryString = query.replace(/[^a-zA-Z0-9_]/g, "").split("").join(".*")
    const reGlobal = /(\S+)\s+(\d+)\s+(\S+) (.*)/g;
    const output = p.execSync(`${global()} -ix ${queryString}`, { cwd, maxBuffer: 10 * 1024 * 1024 });
    const data = parseGlobalOutput(output, reGlobal, 'symbols');

    if (data.length < 512) { // for better performance
        enrichDataWithCtagsInfo(data, cwd);
    }
    return data;
}

export function getDefinitions(symbol: string, cwd: string, regex: RegExp): any[] {
    const output = p.execSync(`${global()} -x ${symbol}`, { cwd });
    return parseGlobalOutput(output, regex, 'definition');
}

function getReferences(symbol: string, cwd: string, regex: RegExp, flag: string): any[] {
    const output = p.execSync(`${global()} -${flag} ${symbol}`, { cwd });
    return parseGlobalOutput(output, regex, 'referencedBy');
}

function parseGlobalOutput(output: Buffer, regex: RegExp, type: string): any[] {
    return [...output.toString().matchAll(regex)].map((x) => ({
        tag: x[1],
        line: x[2],
        filename: x[3],
        content: x[4],
        type,
        function: undefined,
        kind: '',
        extra: undefined,
    }));
}

function enrichDataWithCtagsInfo(data: any[], cwd: string) {
    const fileMap = buildFileSymbolMap(data, cwd);

    for (const item of data) {
        const symbols = fileMap[item.filename];
        if (!symbols) continue;

        const matchingSymbol = symbols.find((s) => s.line <= item.line && s.end >= item.line);

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

        const output = p.execSync(`${ctags()} --fields=+neK -o - --sort=no ${item.filename}`, {
            cwd, maxBuffer: 10 * 1024 * 1024
        });
        fileMap[item.filename] = parseCtagsOutput(output);
    }

    return fileMap;
}

export function parseCtagsOutput(output: Buffer): any[] {
    const reCtags = /(\S+)\t([^\t]+)\t\/\^(.*?)\$?\/;"\t(\S+)\t?(.*)/g;
    return [...output.toString().matchAll(reCtags)].map((item) => {
        const obj: any = {
            name: item[1],
            path: item[2],
            content: item[3],
            kind: item[4],
        };

        item[5].split('\t').forEach((x) => {
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
