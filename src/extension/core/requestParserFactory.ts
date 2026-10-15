// Ported from vscode-restclient (MIT, Copyright (c) 2016-present Huachao Mao).
import { TextDocument } from 'vscode';
import { CurlRequestParser } from './curlRequestParser';
import { HttpRequest } from './httpRequest';
import { HttpRequestParser } from './httpRequestParser';
import { IRestClientSettings } from './settings';

export interface RequestParser {
    parseHttpRequest(name?: string): Promise<HttpRequest>;
}

export class RequestParserFactory {
    private static readonly curlRegex: RegExp = /^\s*curl/i;

    public static createRequestParser(rawHttpRequest: string, settings: IRestClientSettings, document?: TextDocument): RequestParser {
        if (RequestParserFactory.curlRegex.test(rawHttpRequest)) {
            return new CurlRequestParser(rawHttpRequest, settings, document);
        } else {
            return new HttpRequestParser(rawHttpRequest, settings, document);
        }
    }
}
