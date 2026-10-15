// Adapted from vscode-restclient's configurationSettings.ts (MIT, Copyright (c) 2016-present Huachao Mao).
// Instead of a global singleton bound to the active editor, settings are loaded for a given document URI.
import { Uri, workspace } from 'vscode';
import { RequestHeaders } from './base';
import { FormParamEncodingStrategy, fromString as parseFormParamEncodingStrategy } from './formParamEncodingStrategy';
import { RequestMetadataModel } from '../../shared/types';

export type HostCertificates = {
    [key: string]: {
        cert?: string;
        key?: string;
        pfx?: string;
        passphrase?: string;
    }
};

export interface IRestClientSettings {
    readonly followRedirect: boolean;
    readonly defaultHeaders: RequestHeaders;
    readonly timeoutInMilliseconds: number;
    readonly proxy?: string;
    readonly proxyStrictSSL: boolean;
    readonly rememberCookiesForSubsequentRequests: boolean;
    readonly excludeHostsForProxy: string[];
    readonly environmentVariables: { [key: string]: { [key: string]: string } };
    readonly mimeAndFileExtensionMapping: { [key: string]: string };
    readonly hostCertificates: HostCertificates;
    readonly suppressResponseBodyContentTypeValidationWarning: boolean;
    readonly largeResponseBodySizeLimitInMB: number;
    readonly formParamEncodingStrategy: FormParamEncodingStrategy;
    readonly decodeEscapedUnicodeCharacters: boolean;
    readonly useContentDispositionFilename: boolean;
}

export function loadSettings(uri?: Uri, metadata?: RequestMetadataModel): IRestClientSettings {
    const config = workspace.getConfiguration('rest-client', uri);
    const http = workspace.getConfiguration('http');
    const settings: IRestClientSettings = {
        followRedirect: config.get<boolean>('followredirect', true),
        defaultHeaders: config.get<RequestHeaders>('defaultHeaders', {
            'User-Agent': 'vscode-restclient'
        }),
        timeoutInMilliseconds: Math.max(0, config.get<number>('timeoutinmilliseconds', 0)),
        proxy: http.get<string>('proxy'),
        proxyStrictSSL: http.get<boolean>('proxyStrictSSL', false),
        rememberCookiesForSubsequentRequests: config.get<boolean>('rememberCookiesForSubsequentRequests', true),
        excludeHostsForProxy: config.get<string[]>('excludeHostsForProxy', []),
        environmentVariables: config.get<{ [key: string]: { [key: string]: string } }>('environmentVariables', {}),
        mimeAndFileExtensionMapping: config.get<{ [key: string]: string }>('mimeAndFileExtensionMapping', {}),
        hostCertificates: config.get<HostCertificates>('certificates', {}),
        suppressResponseBodyContentTypeValidationWarning: config.get<boolean>('suppressResponseBodyContentTypeValidationWarning', false),
        largeResponseBodySizeLimitInMB: config.get<number>('largeResponseBodySizeLimitInMB', 5),
        formParamEncodingStrategy: parseFormParamEncodingStrategy(config.get<string>('formParamEncodingStrategy', 'automatic')),
        decodeEscapedUnicodeCharacters: config.get<boolean>('decodeEscapedUnicodeCharacters', false),
        useContentDispositionFilename: config.get<boolean>('useContentDispositionFilename', true),
    };

    // Per-request metadata overrides. Unlike REST Client, both flags may apply at once.
    return {
        ...settings,
        // copy so callers can't mutate the configuration object
        defaultHeaders: { ...settings.defaultHeaders },
        followRedirect: metadata?.noRedirect ? false : settings.followRedirect,
        rememberCookiesForSubsequentRequests: metadata?.noCookieJar ? false : settings.rememberCookiesForSubsequentRequests,
    };
}
