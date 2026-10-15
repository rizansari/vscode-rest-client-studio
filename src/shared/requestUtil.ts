// Pure helpers used by the webview to map between table/form editors and REST Client syntax.
import { HttpRequestModel, KeyValue } from './types';

// ---------------------------------------------------------------- headers

export function findHeader(headers: KeyValue[], name: string): KeyValue | undefined {
    const lower = name.toLowerCase();
    return headers.find(h => h.rawLine === undefined && h.enabled && h.key.trim().toLowerCase() === lower);
}

export function getHeaderValue(headers: KeyValue[], name: string): string | undefined {
    return findHeader(headers, name)?.value;
}

/** Sets (or with `undefined`, removes) an enabled header, keeping its position. */
export function setHeader(headers: KeyValue[], name: string, value: string | undefined): KeyValue[] {
    const lower = name.toLowerCase();
    const index = headers.findIndex(h => h.rawLine === undefined && h.enabled && h.key.trim().toLowerCase() === lower);
    if (value === undefined) {
        return index === -1 ? headers : headers.filter((_, i) => i !== index);
    }
    if (index === -1) {
        return [...headers, { key: name, value, enabled: true }];
    }
    return headers.map((h, i) => i === index ? { ...h, value } : h);
}

// ---------------------------------------------------------------- url & params

export interface ParamRow extends KeyValue {
}

export function splitUrl(url: string): { base: string; query: string; hash: string } {
    let rest = url;
    let hash = '';
    const hashIndex = rest.indexOf('#');
    if (hashIndex !== -1 && !rest.substring(hashIndex).includes('}}')) {
        hash = rest.substring(hashIndex);
        rest = rest.substring(0, hashIndex);
    }
    const q = rest.indexOf('?');
    return q === -1
        ? { base: rest, query: '', hash }
        : { base: rest.substring(0, q), query: rest.substring(q + 1), hash };
}

export function parseQuery(query: string): KeyValue[] {
    return query.split('&').filter(p => p.length > 0).map(pair => {
        const eq = pair.indexOf('=');
        return eq === -1
            ? { key: pair, value: '', enabled: true }
            : { key: pair.substring(0, eq), value: pair.substring(eq + 1), enabled: true };
    });
}

export function getParams(request: HttpRequestModel): KeyValue[] {
    return [...parseQuery(splitUrl(request.url).query), ...request.disabledParams.map(p => ({ ...p, enabled: false }))];
}

/** Applies a params table back onto the request: enabled params go into the URL, disabled ones into `disabledParams`. */
export function setParams(request: HttpRequestModel, params: KeyValue[]): HttpRequestModel {
    const { base, hash } = splitUrl(request.url);
    const enabled = params.filter(p => p.enabled && (p.key || p.value));
    const query = enabled.map(p => p.value || p.key.includes('=') ? `${p.key}=${p.value}` : p.key).join('&');
    return {
        ...request,
        url: `${base}${query ? '?' + query : ''}${hash}`,
        disabledParams: params.filter(p => !p.enabled && (p.key || p.value)).map(p => ({ key: p.key, value: p.value, enabled: false })),
    };
}

// ---------------------------------------------------------------- auth

export type AuthType = 'none' | 'basic' | 'digest' | 'bearer' | 'aws' | 'custom';

export interface AuthModel {
    type: AuthType;
    username?: string;
    password?: string;
    token?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
    region?: string;
    service?: string;
    raw?: string;
}

export function parseAuth(value: string | undefined): AuthModel {
    if (value === undefined) {
        return { type: 'none' };
    }
    const trimmed = value.trim();
    const [scheme = '', ...rest] = trimmed.split(/\s+/);
    switch (scheme.toLowerCase()) {
        case 'basic':
        case 'digest': {
            const type = scheme.toLowerCase() as 'basic' | 'digest';
            if (rest.length >= 2) {
                return { type, username: rest[0], password: rest.slice(1).join(' ') };
            }
            if (rest.length === 1 && rest[0].includes(':')) {
                const i = rest[0].indexOf(':');
                return { type, username: rest[0].substring(0, i), password: rest[0].substring(i + 1) };
            }
            if (type === 'basic' && rest.length === 1) {
                // already base64 encoded: editing it as raw text is the only lossless option
                return { type: 'custom', raw: trimmed };
            }
            return { type, username: rest[0] ?? '', password: '' };
        }
        case 'bearer':
            return { type: 'bearer', token: rest.join(' ') };
        case 'aws': {
            const [accessKeyId = '', secretAccessKey = '', ...options] = rest;
            const option = (name: string) => options.find(o => o.startsWith(`${name}:`))?.substring(name.length + 1);
            return {
                type: 'aws', accessKeyId, secretAccessKey,
                sessionToken: option('token'), region: option('region'), service: option('service'),
            };
        }
        default:
            return { type: 'custom', raw: trimmed };
    }
}

export function buildAuth(auth: AuthModel): string | undefined {
    switch (auth.type) {
        case 'none':
            return undefined;
        case 'basic':
        case 'digest':
            return `${auth.type === 'basic' ? 'Basic' : 'Digest'} ${auth.username ?? ''} ${auth.password ?? ''}`.trimEnd();
        case 'bearer':
            return `Bearer ${auth.token ?? ''}`.trimEnd();
        case 'aws': {
            const parts = ['AWS', auth.accessKeyId ?? '', auth.secretAccessKey ?? ''];
            if (auth.sessionToken) {
                parts.push(`token:${auth.sessionToken}`);
            }
            if (auth.region) {
                parts.push(`region:${auth.region}`);
            }
            if (auth.service) {
                parts.push(`service:${auth.service}`);
            }
            return parts.join(' ');
        }
        case 'custom':
            return auth.raw ?? '';
    }
}

// ---------------------------------------------------------------- body

export type BodyMode = 'none' | 'raw' | 'form-urlencoded' | 'multipart' | 'graphql' | 'file';
export type RawLanguage = 'json' | 'xml' | 'html' | 'javascript' | 'text';

export const fileReferenceRegex = /^<(@(\w+)?)?\s+(.+?)\s*$/;

export function detectBodyMode(request: HttpRequestModel): BodyMode {
    const contentType = getHeaderValue(request.headers, 'Content-Type')?.toLowerCase() ?? '';
    if (getHeaderValue(request.headers, 'X-Request-Type')?.toLowerCase() === 'graphql') {
        return 'graphql';
    }
    if (contentType.startsWith('application/x-www-form-urlencoded')) {
        return 'form-urlencoded';
    }
    if (contentType.startsWith('multipart/form-data')) {
        return 'multipart';
    }
    const lines = request.body.split('\n').filter(l => l.trim());
    if (lines.length === 1 && fileReferenceRegex.test(lines[0].trim())) {
        return 'file';
    }
    return request.body.trim() ? 'raw' : 'none';
}

export function detectRawLanguage(request: HttpRequestModel): RawLanguage {
    const contentType = getHeaderValue(request.headers, 'Content-Type')?.toLowerCase() ?? '';
    if (contentType.includes('json')) {
        return 'json';
    }
    if (contentType.includes('xml')) {
        return 'xml';
    }
    if (contentType.includes('html')) {
        return 'html';
    }
    if (contentType.includes('javascript')) {
        return 'javascript';
    }
    // no content type, or one that comes from a variable: sniff the body
    if ((!contentType || contentType.includes('{{')) && /^\s*[{[]/.test(request.body)) {
        return 'json';
    }
    return 'text';
}

export const rawContentTypes: Record<RawLanguage, string> = {
    json: 'application/json',
    xml: 'application/xml',
    html: 'text/html',
    javascript: 'application/javascript',
    text: 'text/plain',
};

// form-urlencoded: `a=1` on the first line, `&b=2` on the next ones, disabled as `# &c=3`

export function parseFormBody(body: string): KeyValue[] {
    const rows: KeyValue[] = [];
    for (const line of body.split('\n')) {
        const disabled = line.match(/^\s*(?:#|\/\/)\s*&?(.*)$/);
        const text = disabled ? disabled[1] : line.trim();
        for (const pair of text.split('&').filter(p => p.trim().length > 0)) {
            const eq = pair.indexOf('=');
            rows.push(eq === -1
                ? { key: pair.trim(), value: '', enabled: !disabled }
                : { key: pair.substring(0, eq).trim(), value: pair.substring(eq + 1), enabled: !disabled });
        }
    }
    return rows;
}

export function buildFormBody(rows: KeyValue[]): string {
    const lines: string[] = [];
    let first = true;
    for (const row of rows.filter(r => r.key || r.value)) {
        if (row.enabled) {
            lines.push(`${first ? '' : '&'}${row.key}=${row.value}`);
            first = false;
        }
    }
    for (const row of rows.filter(r => !r.enabled && (r.key || r.value))) {
        lines.push(`# &${row.key}=${row.value}`);
    }
    return lines.join('\n');
}

// multipart/form-data

export interface MultipartRow {
    key: string;
    value: string;
    type: 'text' | 'file';
    contentType?: string;
}

export const defaultBoundary = '----RestClientStudioBoundary';

export function getBoundary(headers: KeyValue[]): string | undefined {
    const contentType = getHeaderValue(headers, 'Content-Type') ?? '';
    const m = contentType.match(/boundary=("?)([^";]+)\1/i);
    return m?.[2];
}

export function parseMultipartBody(body: string, boundary: string): MultipartRow[] | undefined {
    const delimiter = `--${boundary}`;
    const lines = body.split('\n').map(l => l.replace(/\r$/, ''));
    const rows: MultipartRow[] = [];
    let i = 0;
    while (i < lines.length && lines[i].trim() === '') {
        i++;
    }
    if (i < lines.length && lines[i].trim() !== delimiter) {
        return lines.slice(i).every(l => !l.trim()) ? [] : undefined;
    }
    while (i < lines.length) {
        const line = lines[i].trim();
        if (line === `${delimiter}--`) {
            return rows;
        }
        if (line !== delimiter) {
            return undefined;
        }
        i++;
        // part headers
        let name: string | undefined;
        let filename: string | undefined;
        let contentType: string | undefined;
        while (i < lines.length && lines[i].trim() !== '') {
            const header = lines[i];
            const disposition = header.match(/^content-disposition:\s*form-data(.*)$/i);
            if (disposition) {
                name = disposition[1].match(/;\s*name="([^"]*)"/i)?.[1];
                filename = disposition[1].match(/;\s*filename="([^"]*)"/i)?.[1];
            } else {
                const ct = header.match(/^content-type:\s*(.*)$/i);
                if (ct) {
                    contentType = ct[1].trim();
                } else {
                    return undefined;
                }
            }
            i++;
        }
        i++; // blank line
        const valueLines: string[] = [];
        while (i < lines.length && !lines[i].trim().startsWith(delimiter)) {
            valueLines.push(lines[i]);
            i++;
        }
        if (name === undefined) {
            return undefined;
        }
        const value = valueLines.join('\n');
        const fileRef = value.trim().match(fileReferenceRegex);
        if (filename !== undefined || fileRef) {
            rows.push({ key: name, value: fileRef ? fileRef[3] : value, type: 'file', contentType });
        } else {
            rows.push({ key: name, value, type: 'text', contentType });
        }
    }
    return undefined;
}

export function buildMultipartBody(rows: MultipartRow[], boundary: string): string {
    const lines: string[] = [];
    for (const row of rows.filter(r => r.key || r.value)) {
        lines.push(`--${boundary}`);
        if (row.type === 'file') {
            const filename = row.value.split(/[\\/]/).pop() || 'file';
            lines.push(`Content-Disposition: form-data; name="${row.key}"; filename="${filename}"`);
            lines.push(`Content-Type: ${row.contentType || 'application/octet-stream'}`);
            lines.push('');
            lines.push(`< ${row.value}`);
        } else {
            lines.push(`Content-Disposition: form-data; name="${row.key}"`);
            if (row.contentType) {
                lines.push(`Content-Type: ${row.contentType}`);
            }
            lines.push('');
            lines.push(row.value);
        }
    }
    lines.push(`--${boundary}--`);
    return lines.join('\n');
}

// GraphQL: query, a blank line, then the variables JSON (the query itself can't contain blank lines)

export function splitGraphQl(body: string): { query: string; variables: string } {
    const lines = body.split('\n');
    const blank = lines.findIndex(l => l.trim() === '');
    if (blank === -1) {
        return { query: body, variables: '' };
    }
    return { query: lines.slice(0, blank).join('\n'), variables: lines.slice(blank + 1).join('\n') };
}

export function joinGraphQl(query: string, variables: string): string {
    // blank lines would end the query early
    const q = query.split('\n').filter(l => l.trim() !== '').join('\n');
    return variables.trim() ? `${q}\n\n${variables}` : q;
}

// file reference

export function parseFileReference(body: string): { path: string; processVariables: boolean; encoding?: string } | undefined {
    const m = body.trim().match(fileReferenceRegex);
    return m ? { path: m[3], processVariables: !!m[1], encoding: m[2] } : undefined;
}

export function buildFileReference(path: string, processVariables: boolean, encoding?: string): string {
    return `<${processVariables ? '@' + (encoding ?? '') : ''} ${path}`;
}

// ---------------------------------------------------------------- variables

export const variableRegex = /\{\{(.+?)\}\}/g;

export function requestDisplayName(request: HttpRequestModel): string {
    if (request.title) {
        return request.title;
    }
    if (request.metadata.name) {
        return request.metadata.name;
    }
    if (request.curl !== undefined) {
        return request.curl.split('\n')[0].substring(0, 60);
    }
    return request.url || 'Untitled request';
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
        return `${(bytes / 1024).toFixed(2)} KB`;
    }
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}
