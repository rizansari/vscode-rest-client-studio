import * as fs from 'fs-extra';
import * as path from 'path';
import * as vscode from 'vscode';
import { HistoryEntry } from '../../shared/types';

export class HistoryService implements vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<HistoryEntry[]>();
    public readonly onDidChange = this.emitter.event;
    private readonly filePath: string;
    private cache: HistoryEntry[] | undefined;
    private writing: Promise<void> = Promise.resolve();

    public constructor(storageUri: vscode.Uri) {
        this.filePath = path.join(storageUri.fsPath, 'history.json');
    }

    public async getAll(): Promise<HistoryEntry[]> {
        if (!this.cache) {
            try {
                this.cache = await fs.readJson(this.filePath);
            } catch {
                this.cache = [];
            }
        }
        return this.cache!;
    }

    public async get(id: string): Promise<HistoryEntry | undefined> {
        return (await this.getAll()).find(e => e.id === id);
    }

    public async add(entry: HistoryEntry): Promise<void> {
        const limit = vscode.workspace.getConfiguration('restClientStudio').get<number>('historyLimit', 100);
        const entries = [entry, ...await this.getAll()].slice(0, Math.max(1, limit));
        await this.write(entries);
    }

    public async clear(): Promise<void> {
        await this.write([]);
    }

    private async write(entries: HistoryEntry[]): Promise<void> {
        this.cache = entries;
        this.emitter.fire(entries);
        this.writing = this.writing.then(async () => {
            await fs.ensureDir(path.dirname(this.filePath));
            await fs.writeJson(this.filePath, entries);
        }).catch(() => undefined);
        await this.writing;
    }

    public dispose() {
        this.emitter.dispose();
    }
}
