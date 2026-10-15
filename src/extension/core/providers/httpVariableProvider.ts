// Ported from vscode-restclient (MIT, Copyright (c) 2016-present Huachao Mao).
import { TextDocument } from "vscode";
import { HttpResponse } from '../httpResponse';
import { VariableType } from '../variableType';

export type HttpVariableValue = string | {} | HttpResponse;

export interface HttpVariable {
    name: string;
    value?: HttpVariableValue;
    error?: any;
    warning?: any;
}

export interface HttpVariableContext {
    rawRequest: string;
    parsedRequest: string;
}

export interface HttpVariableProvider {
    readonly type: VariableType;
    has(name: string, document?: TextDocument, context?: HttpVariableContext): Promise<boolean>;
    get(name: string, document?: TextDocument, context?: HttpVariableContext): Promise<HttpVariable>;
    getAll(document?: TextDocument, context?: HttpVariableContext): Promise<HttpVariable[]>;
}
