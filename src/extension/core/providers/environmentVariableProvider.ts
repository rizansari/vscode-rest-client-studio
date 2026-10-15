// Ported from vscode-restclient (MIT, Copyright (c) 2016-present Huachao Mao).
import { TextDocument } from 'vscode';
import * as Constants from '../constants';
import { ResolveErrorMessage } from '../httpVariableResolveResult';
import { loadSettings } from '../settings';
import { UserDataManager } from '../userDataManager';
import { VariableType } from '../variableType';
import { HttpVariable, HttpVariableProvider } from './httpVariableProvider';

export async function getCurrentEnvironmentName(): Promise<string> {
    const stored = await UserDataManager.getEnvironment();
    return stored?.name ?? Constants.NoEnvironmentSelectedName;
}

export class EnvironmentVariableProvider implements HttpVariableProvider {
    private static _instance: EnvironmentVariableProvider;

    public static get Instance(): EnvironmentVariableProvider {
        if (!this._instance) {
            this._instance = new EnvironmentVariableProvider();
        }

        return this._instance;
    }

    private constructor() {
    }

    public readonly type: VariableType = VariableType.Environment;

    public async has(name: string, document?: TextDocument): Promise<boolean> {
        const variables = await this.getAvailableVariables(document);
        return name in variables;
    }

    public async get(name: string, document?: TextDocument): Promise<HttpVariable> {
        const variables = await this.getAvailableVariables(document);
        if (!(name in variables)) {
            return { name, error: ResolveErrorMessage.EnvironmentVariableNotExist };
        }

        return { name, value: variables[name] };
    }

    public async getAll(document?: TextDocument): Promise<HttpVariable[]> {
        const variables = await this.getAvailableVariables(document);
        return Object.keys(variables).map(key => ({ name: key, value: variables[key] }));
    }

    private async getAvailableVariables(document?: TextDocument): Promise<{ [key: string]: string }> {
        let environmentName = await getCurrentEnvironmentName();
        if (environmentName === Constants.NoEnvironmentSelectedName) {
            environmentName = Constants.SharedEnvironmentName;
        }
        const variables = loadSettings(document?.uri).environmentVariables;
        // copy: the substitutions below must not mutate the configuration object
        const currentEnvironmentVariables = { ...variables[environmentName] };
        const sharedEnvironmentVariables = { ...variables[Constants.SharedEnvironmentName] };

        // Resolve mappings from shared environment
        this.mapEnvironmentVariables('shared', sharedEnvironmentVariables, sharedEnvironmentVariables);
        this.mapEnvironmentVariables('shared', currentEnvironmentVariables, sharedEnvironmentVariables);

        // Resolve mappings from current environment
        this.mapEnvironmentVariables(environmentName, currentEnvironmentVariables, currentEnvironmentVariables);
        return { ...sharedEnvironmentVariables, ...currentEnvironmentVariables };
    }

    private mapEnvironmentVariables(environment: string, current: { [key: string]: string }, shared: { [key: string]: string }) {
        for (const [key, value] of Object.entries(current)) {
            if (typeof value !== 'string') {
                continue;
            }
            const variableRegex = new RegExp(`\\{{2}\\$${environment.replace(/[$]/g, '\\$')} (.+?)\\}{2}`);
            const match = variableRegex.exec(value);

            if (!match) {
                continue;
            }

            const referenceKey = match[1].trim();

            current[key] = current[key]!.replace(
                variableRegex,
                shared[referenceKey]!);
        }
    }
}
