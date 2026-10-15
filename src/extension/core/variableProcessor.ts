// Ported from vscode-restclient (MIT, Copyright (c) 2016-present Huachao Mao).
// The document is passed in explicitly instead of being read from the active text editor.
import { TextDocument } from 'vscode';
import { EnvironmentVariableProvider } from './providers/environmentVariableProvider';
import { FileVariableProvider } from './providers/fileVariableProvider';
import { HttpVariableProvider } from './providers/httpVariableProvider';
import { RequestVariableProvider } from './providers/requestVariableProvider';
import { SystemVariableProvider } from './providers/systemVariableProvider';

export interface UnresolvedVariable {
    name: string;
    message: string;
}

export class VariableProcessor {

    private static get providers(): [HttpVariableProvider, boolean][] {
        return [
            [SystemVariableProvider.Instance, false],
            [RequestVariableProvider.Instance, true],
            [FileVariableProvider.Instance, true],
            [EnvironmentVariableProvider.Instance, true],
        ];
    }

    public static async processRawRequest(
        request: string,
        document: TextDocument | undefined,
        resolvedVariables: Map<string, string> = new Map<string, string>(),
        unresolved?: UnresolvedVariable[]): Promise<string> {
        const variableReferenceRegex = /\{{2}(.+?)\}{2}/g;
        let result = '';
        let match: RegExpExecArray | null;
        let lastIndex = 0;
        variable:
        while (match = variableReferenceRegex.exec(request)) {
            result += request.substring(lastIndex, match.index);
            lastIndex = variableReferenceRegex.lastIndex;
            const name = match[1].trim();
            const context = { rawRequest: request, parsedRequest: result };
            let message = 'Variable is not defined';
            for (const [provider, cacheable] of this.providers) {
                if (resolvedVariables.has(name)) {
                    result += resolvedVariables.get(name);
                    continue variable;
                }
                if (await provider.has(name, document, context)) {
                    const { value, error, warning } = await provider.get(name, document, context);
                    if (!error && !warning) {
                        if (cacheable) {
                            resolvedVariables.set(name, value as string);
                        }
                        result += value;
                        continue variable;
                    } else {
                        message = String(error || warning);
                        break;
                    }
                }
            }

            unresolved?.push({ name, message });
            result += `{{${name}}}`;
        }
        result += request.substring(lastIndex);
        return result;
    }
}
