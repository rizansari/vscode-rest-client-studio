import * as path from 'path';
import * as vscode from 'vscode';
import { NoEnvironmentSelectedName, SharedEnvironmentName } from '../core/constants';
import { getCurrentEnvironmentName } from '../core/providers/environmentVariableProvider';
import { UserDataManager } from '../core/userDataManager';
import { EnvironmentInfo } from '../../shared/types';

type EnvironmentVariables = Record<string, Record<string, string>>;

/** Environments live in `rest-client.environmentVariables`; the selection is shared with REST Client via environment.json. */
export class EnvironmentService implements vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<void>();
    public readonly onDidChange = this.emitter.event;
    private readonly disposables: vscode.Disposable[] = [this.emitter];

    public constructor() {
        this.disposables.push(vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('rest-client.environmentVariables')) {
                this.emitter.fire();
            }
        }));

        // REST Client may switch the environment too
        const file = UserDataManager.environmentFilePath;
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.file(path.dirname(file)), path.basename(file)));
        watcher.onDidChange(() => this.emitter.fire());
        watcher.onDidCreate(() => this.emitter.fire());
        this.disposables.push(watcher);
    }

    public async getInfo(uri?: vscode.Uri): Promise<EnvironmentInfo> {
        const variables = vscode.workspace.getConfiguration('rest-client', uri)
            .get<EnvironmentVariables>('environmentVariables', {});
        const current = await getCurrentEnvironmentName();
        return {
            names: Object.keys(variables).filter(n => n !== SharedEnvironmentName),
            current: current === NoEnvironmentSelectedName ? null : current,
            variables,
        };
    }

    public async select(name: string | null): Promise<void> {
        await UserDataManager.setEnvironment(name === null
            ? { name: NoEnvironmentSelectedName, label: 'No Environment', description: 'You can still use variables defined in the $shared environment' }
            : { name, label: name });
        this.emitter.fire();
    }

    /** Saves to the scope that currently defines the environments: workspace folder, workspace or user settings. */
    public async save(variables: EnvironmentVariables, uri?: vscode.Uri): Promise<void> {
        const config = vscode.workspace.getConfiguration('rest-client', uri);
        const inspected = config.inspect<EnvironmentVariables>('environmentVariables');
        let target = vscode.ConfigurationTarget.Global;
        if (inspected?.workspaceFolderValue !== undefined) {
            target = vscode.ConfigurationTarget.WorkspaceFolder;
        } else if (inspected?.workspaceValue !== undefined) {
            target = vscode.ConfigurationTarget.Workspace;
        }
        await config.update('environmentVariables', variables, target);
    }

    public dispose() {
        this.disposables.forEach(d => d.dispose());
    }
}
