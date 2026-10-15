import * as vscode from 'vscode';
import * as Constants from '../core/constants';
import { EnvironmentVariableProvider } from '../core/providers/environmentVariableProvider';
import { FileVariableProvider } from '../core/providers/fileVariableProvider';
import { RequestVariableProvider } from '../core/providers/requestVariableProvider';
import { VariableInfo } from '../../shared/types';

const systemVariables = [
    Constants.GuidVariableName,
    Constants.RandomIntVariableName,
    Constants.TimeStampVariableName,
    Constants.DateTimeVariableName,
    Constants.LocalDateTimeVariableName,
    Constants.ProcessEnvVariableName,
    Constants.DotenvVariableName,
    Constants.AzureActiveDirectoryV2TokenVariableName,
];

/** Lists the variables visible to a document, for the Variables panel and `{{var}}` hovers. */
export async function listVariables(document: vscode.TextDocument): Promise<VariableInfo[]> {
    const result: VariableInfo[] = [];
    const stringify = (v: unknown) => typeof v === 'string' ? v : v === undefined ? undefined : JSON.stringify(v);

    try {
        for (const v of await FileVariableProvider.Instance.getAll(document)) {
            result.push({ name: v.name, value: stringify(v.value), source: 'file' });
        }
    } catch {
        // a broken file variable shouldn't hide the others
    }
    for (const v of await EnvironmentVariableProvider.Instance.getAll(document)) {
        result.push({ name: v.name, value: stringify(v.value), source: 'environment' });
    }
    for (const v of await RequestVariableProvider.Instance.getAll(document)) {
        result.push({ name: v.name, source: 'request', sent: v.value !== undefined });
    }
    for (const name of systemVariables) {
        result.push({ name, source: 'system' });
    }
    return result;
}
