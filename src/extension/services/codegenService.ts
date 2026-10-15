// HAR conversion ported from vscode-restclient's codeSnippetController.ts (MIT, Copyright (c) 2016-present Huachao Mao).
import { EOL } from 'os';
import * as url from 'url';
import { HARCookie, HARHeader, HARHttpRequest, HARPostData } from '../core/harHttpRequest';
import { HttpRequest } from '../core/httpRequest';
import { base64 } from '../core/misc';
import { CodegenTarget } from '../../shared/types';

const encodeUrl = require('encodeurl');
const { HTTPSnippet, availableTargets } = require('httpsnippet');

export class CodegenService {
    public getTargets(): CodegenTarget[] {
        return (availableTargets() as any[]).map(t => ({
            key: t.key,
            title: t.title,
            clients: (t.clients as any[]).map(c => ({ key: c.key, title: c.title })),
        }));
    }

    public generate(request: HttpRequest, target: string, client: string): string {
        const har = this.convertToHARHttpRequest(request);
        const addPrefix = !(url.parse(har.url).protocol);
        const originalUrl = har.url;
        if (addPrefix) {
            // Add protocol for url that doesn't specify protocol to pass the HTTPSnippet validation #328
            har.url = `http://${originalUrl}`;
        }
        const snippet = new HTTPSnippet(har);
        if (addPrefix) {
            snippet.requests[0].fullUrl = originalUrl;
        }
        const options = target === 'shell' && client === 'curl' && process.platform === 'win32' ? { indent: false } : {};
        const result = snippet.convert(target, client, options);
        if (result === false) {
            throw new Error(`Unsupported code snippet target ${target}/${client}`);
        }
        return Array.isArray(result) ? result.join('\n\n') : result;
    }

    private convertToHARHttpRequest(request: HttpRequest): HARHttpRequest {
        // convert headers
        const headers: HARHeader[] = [];
        for (const key in request.headers) {
            const headerValue = request.headers[key];
            if (!headerValue) {
                continue;
            }
            const headerValues = Array.isArray(headerValue) ? headerValue : [headerValue.toString()];
            for (let value of headerValues) {
                if (key.toLowerCase() === 'authorization') {
                    value = CodegenService.normalizeAuthHeader(value);
                }
                headers.push(new HARHeader(key, value));
            }
        }

        // convert cookie headers
        const cookies: HARCookie[] = [];
        const cookieHeader = headers.find(header => header.name.toLowerCase() === 'cookie');
        if (cookieHeader) {
            cookieHeader.value.split(';').forEach(pair => {
                const [headerName, headerValue = ''] = pair.split('=', 2);
                cookies.push(new HARCookie(headerName.trim(), headerValue.trim()));
            });
        }

        // convert body
        let body: HARPostData | undefined;
        if (request.body) {
            const contentTypeHeader = headers.find(header => header.name.toLowerCase() === 'content-type');
            const mimeType: string = contentTypeHeader?.value ?? 'application/json';
            if (typeof request.body === 'string') {
                const normalizedBody = request.body.split(EOL).reduce((prev, cur) => prev.concat(cur.trim()), '');
                body = new HARPostData(mimeType, normalizedBody);
            } else {
                body = new HARPostData(mimeType, request.rawBody!);
            }
        }

        return new HARHttpRequest(request.method, encodeUrl(request.url), headers, cookies, body);
    }

    private static normalizeAuthHeader(authHeader: string) {
        if (authHeader) {
            const start = authHeader.indexOf(' ');
            const scheme = authHeader.substr(0, start);
            if (scheme.toLowerCase() === 'basic') {
                const params = authHeader.substr(start).trim().split(' ');
                if (params.length === 2) {
                    return `Basic ${base64(`${params[0]}:${params[1]}`)}`;
                } else if (params.length === 1 && params[0].includes(':')) {
                    const [user, password] = params[0].split(':');
                    return `Basic ${base64(`${user}:${password}`)}`;
                }
            }
        }

        return authHeader;
    }
}
