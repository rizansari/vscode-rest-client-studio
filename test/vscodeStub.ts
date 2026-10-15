// Minimal stand-in for the `vscode` module so the request pipeline can run under vitest.
import * as path from 'path';

export const configuration: Record<string, Record<string, unknown>> = {
    'rest-client': {},
    http: {},
    restClientStudio: {},
};

export const answers = {
    inputBox: [] as (string | undefined)[],
    warning: 'Send' as string | undefined,
};

export class Uri {
    private constructor(public readonly scheme: string, public readonly fsPath: string) {
    }
    static file(p: string) {
        return new Uri('file', p);
    }
    static parse(value: string) {
        return new Uri('file', value.replace(/^file:\/\//, ''));
    }
    static joinPath(base: Uri, ...parts: string[]) {
        return new Uri(base.scheme, path.join(base.fsPath, ...parts));
    }
    toString() {
        return `${this.scheme}://${this.fsPath}`;
    }
}

export class EventEmitter<T> {
    private listeners: ((e: T) => void)[] = [];
    event = (listener: (e: T) => void) => {
        this.listeners.push(listener);
        return { dispose: () => { this.listeners = this.listeners.filter(l => l !== listener); } };
    };
    fire(e: T) {
        this.listeners.forEach(l => l(e));
    }
    dispose() {
        this.listeners = [];
    }
}

export class RelativePattern {
    constructor(public base: unknown, public pattern: string) {
    }
}

export const workspace = {
    getConfiguration(section: string) {
        const values = configuration[section] ?? {};
        return {
            get<T>(key: string, defaultValue?: T): T {
                return (key in values ? values[key] : defaultValue) as T;
            },
            inspect() {
                return { globalValue: values };
            },
            async update(key: string, value: unknown) {
                values[key] = value;
            },
        };
    },
    getWorkspaceFolder() {
        return undefined;
    },
    onDidChangeConfiguration() {
        return { dispose() { } };
    },
    createFileSystemWatcher() {
        return { onDidChange() { }, onDidCreate() { }, dispose() { } };
    },
};

export const window = {
    async showInputBox() {
        return answers.inputBox.shift();
    },
    async showWarningMessage() {
        return answers.warning;
    },
    showErrorMessage() {
        return undefined;
    },
    showInformationMessage() {
        return undefined;
    },
};

export const env = {
    clipboard: { async writeText() { }, async readText() { return ''; } },
};

export const commands = {
    async executeCommand() {
        return undefined;
    },
};

export enum ConfigurationTarget {
    Global = 1,
    Workspace = 2,
    WorkspaceFolder = 3,
}

/** Creates an object that looks enough like a TextDocument. */
export function createDocument(fileName: string, text: string) {
    let version = 1;
    let content = text;
    return {
        uri: Uri.file(fileName),
        fileName,
        get version() {
            return version;
        },
        getText() {
            return content;
        },
        setText(next: string) {
            content = next;
            version++;
        },
    };
}
