// Ported from vscode-restclient (MIT, Copyright (c) 2016-present Huachao Mao).
import * as fs from 'fs-extra';
import * as path from 'path';
import { TextDocument, workspace } from 'vscode';
import { RequestHeaders } from './base';
import { removeHeader } from './misc';

export function parseRequestHeaders(headerLines: string[], defaultHeaders: RequestHeaders, url: string): RequestHeaders {
    // message-header = field-name ":" [ field-value ]
    const headers: RequestHeaders = {};
    const headerNames: { [key: string]: string } = {};
    headerLines.forEach(headerLine => {
        let fieldName: string;
        let fieldValue: string;
        const separatorIndex = headerLine.indexOf(':');
        if (separatorIndex === -1) {
            fieldName = headerLine.trim();
            fieldValue = '';
        } else {
            fieldName = headerLine.substring(0, separatorIndex).trim();
            fieldValue = headerLine.substring(separatorIndex + 1).trim();
        }

        const normalizedFieldName = fieldName.toLowerCase();
        if (!headerNames[normalizedFieldName]) {
            headerNames[normalizedFieldName] = fieldName;
            headers[fieldName] = fieldValue;
        } else {
            const splitter = normalizedFieldName === 'cookie' ? ';' : ',';
            headers[headerNames[normalizedFieldName]] += `${splitter}${fieldValue}`;
        }
    });

    if (url[0] !== '/') {
        removeHeader(defaultHeaders, 'host');
    }

    return { ...defaultHeaders, ...headers };
}

export async function resolveRequestBodyPath(refPath: string, document?: TextDocument): Promise<string | undefined> {
    if (path.isAbsolute(refPath)) {
        return (await fs.pathExists(refPath)) ? refPath : undefined;
    }

    const workspaceRoot = document && workspace.getWorkspaceFolder(document.uri)?.uri.fsPath;
    if (workspaceRoot) {
        const absolutePath = path.join(workspaceRoot, refPath);
        if (await fs.pathExists(absolutePath)) {
            return absolutePath;
        }
    }

    const currentFile = document?.fileName;
    if (currentFile) {
        const absolutePath = path.join(path.dirname(currentFile), refPath);
        if (await fs.pathExists(absolutePath)) {
            return absolutePath;
        }
    }

    return undefined;
}