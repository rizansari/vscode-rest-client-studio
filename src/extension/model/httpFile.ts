import {
    CommentIdentifiersRegex, DelimiterRegex, FileVariableDefinitionRegex, HttpMethods, PromptCommentRegex,
    RequestMetadataRegex, ResponseStatusLineRegex
} from '../core/constants';
import {
    FileVariable, HttpRequestModel, KeyValue, ParsedHttpFile, ParsedRequest, PromptDefinition, RequestMetadataModel
} from '../../shared/types';

// Parses a .http file into an editable model, and edits it while keeping every untouched line byte-for-byte.
//
// A file is split into segments by `###` delimiter lines. A segment holds, in order:
//   leading lines   blank lines, comments, `# @metadata` and `@var = value` lines
//   request         request line (+ `?`/`&` continuation lines), headers, blank line, body
//   trailing lines  trailing blank lines, comments, a pasted response, ...
// An edit rewrites only the parts of one segment that changed.

type Range = [number, number];   // inclusive line range; empty when end < start

interface RequestDetail {
    model: ParsedRequest;
    segmentStart: number;
    segmentEnd: number;
    urlRange: Range;
    headerRange: Range;
    /** Blank separator line + body lines. */
    bodyRange: Range;
}

interface SegmentInfo {
    delimiterLine?: number;
    start: number;
    end: number;
    request?: RequestDetail;
}

interface DetailedFile {
    lines: string[];
    eol: '\n' | '\r\n';
    segments: SegmentInfo[];
    requests: RequestDetail[];
    fileVariables: FileVariable[];
}

const methodRegex = new RegExp(`^\\s*(${HttpMethods.join('|')})\\s+`, 'i');
const httpVersionRegex = /\s+(HTTP\/[\d.]+)\s*$/i;
const queryContinuationRegex = /^\s*[?&]/;
const disabledQueryRegex = /^\s*(?:#|\/{2})\s*([?&].*)$/;
const disabledHeaderRegex = /^\s*(?:#|\/{2})\s*([A-Za-z0-9!#$%&'*+.^_`|~-]+)\s*:\s?(.*)$/;
const curlRegex = /^\s*curl/i;
const knownMetadata = new Set(['name', 'note', 'no-redirect', 'no-cookie-jar', 'prompt']);

export const isCommentLine = (line: string) => CommentIdentifiersRegex.test(line);
export const isEmptyLine = (line: string) => line.trim() === '';
export const isFileVariableLine = (line: string) => FileVariableDefinitionRegex.test(line);
export const isDelimiterLine = (line: string) => DelimiterRegex.test(line);
const isResponseStatusLine = (line: string) => ResponseStatusLineRegex.test(line);

function isKnownMetadataLine(line: string): boolean {
    const m = line.match(RequestMetadataRegex);
    return !!m && knownMetadata.has(m[1].toLowerCase());
}

export function splitLines(text: string): string[] {
    return text.split(/\r?\n/);
}

// ---------------------------------------------------------------- parsing

export function parseHttpFile(text: string): ParsedHttpFile {
    const detail = parseDetailed(text);
    return {
        requests: detail.requests.map(r => r.model),
        fileVariables: detail.fileVariables,
        eol: detail.eol,
    };
}

function parseDetailed(text: string): DetailedFile {
    const lines = splitLines(text);
    const eol = text.includes('\r\n') ? '\r\n' : '\n';

    const segments: SegmentInfo[] = [];
    let start = 0;
    let delimiterLine: number | undefined;
    for (let i = 0; i < lines.length; i++) {
        if (isDelimiterLine(lines[i])) {
            segments.push({ delimiterLine, start, end: i - 1 });
            delimiterLine = i;
            start = i + 1;
        }
    }
    segments.push({ delimiterLine, start, end: lines.length - 1 });

    const requests: RequestDetail[] = [];
    for (const segment of segments) {
        const request = parseSegment(lines, segment, requests.length);
        if (request) {
            segment.request = request;
            requests.push(request);
        }
    }

    const fileVariables: FileVariable[] = [];
    lines.forEach((line, i) => {
        const m = line.match(FileVariableDefinitionRegex);
        if (m) {
            fileVariables.push({ key: m[1], value: m[2], line: i });
        }
    });

    return { lines, eol, segments, requests, fileVariables };
}

function parseSegment(lines: string[], segment: SegmentInfo, index: number): RequestDetail | undefined {
    const { start, end } = segment;
    let i = start;
    while (i <= end) {
        const line = lines[i];
        if (isResponseStatusLine(line)) {
            return undefined;
        }
        if (isEmptyLine(line) || isCommentLine(line) || isFileVariableLine(line)) {
            i++;
            continue;
        }
        break;
    }
    if (i > end) {
        return undefined;
    }

    const title = segment.delimiterLine !== undefined
        ? lines[segment.delimiterLine].replace(DelimiterRegex, '').trim() || undefined
        : undefined;
    const metadata = parseMetadata(lines.slice(start, i));
    const requestStart = i;

    const model: ParsedRequest = {
        index,
        title,
        metadata,
        method: 'GET',
        url: '',
        disabledParams: [],
        headers: [],
        body: '',
        delimiterLine: segment.delimiterLine,
        startLine: requestStart,
        endLine: requestStart,
    };

    // curl command: everything up to the last non-empty, non-comment line
    if (curlRegex.test(lines[requestStart])) {
        let last = requestStart;
        for (let j = requestStart; j <= end && !isResponseStatusLine(lines[j]); j++) {
            if (!isEmptyLine(lines[j]) && !isCommentLine(lines[j])) {
                last = j;
            }
        }
        model.curl = lines.slice(requestStart, last + 1).join('\n');
        model.method = '';
        model.endLine = last;
        return {
            model, segmentStart: start, segmentEnd: end,
            urlRange: [requestStart, last], headerRange: [last + 1, last], bodyRange: [last + 1, last],
        };
    }

    // request line + query continuation lines
    const firstLine = lines[requestStart].trim();
    const methodMatch = methodRegex.exec(firstLine);
    let urlText: string;
    if (methodMatch) {
        model.method = methodMatch[1].toUpperCase();
        urlText = firstLine.substring(methodMatch[0].length);
    } else {
        urlText = firstLine;
    }
    let j = requestStart + 1;
    while (j <= end) {
        const line = lines[j];
        if (queryContinuationRegex.test(line)) {
            urlText += line.trim();
            j++;
            continue;
        }
        const disabled = line.match(disabledQueryRegex);
        if (disabled) {
            model.disabledParams.push(parseQueryPair(disabled[1].substring(1), false));
            j++;
            continue;
        }
        break;
    }
    const versionMatch = httpVersionRegex.exec(urlText);
    if (versionMatch) {
        model.httpVersion = versionMatch[1];
        urlText = urlText.substring(0, versionMatch.index);
    }
    model.url = urlText.trim();
    const urlRange: Range = [requestStart, j - 1];
    let lastContentLine = j - 1;

    // headers
    const headerStart = j;
    while (j <= end && !isEmptyLine(lines[j]) && !isResponseStatusLine(lines[j])) {
        model.headers.push(parseHeaderLine(lines[j]));
        j++;
    }
    const headerRange: Range = [headerStart, j - 1];
    if (j > headerStart) {
        lastContentLine = j - 1;
    }

    // body: from the line after the blank separator to the last content line; trailing comment
    // lines belong to the body only when attached to it (no blank line in between)
    let bodyRange: Range = [j, j - 1];
    if (j <= end && isEmptyLine(lines[j])) {
        const bodyStart = j + 1;
        let stop = bodyStart;
        while (stop <= end && !isResponseStatusLine(lines[stop])) {
            stop++;
        }
        let last = stop - 1;
        while (last >= bodyStart && isEmptyLine(lines[last])) {
            last--;
        }
        // drop a trailing group of comment lines that's separated from the body by a blank line
        let k = last;
        while (k >= bodyStart && isCommentLine(lines[k])) {
            k--;
        }
        if (k < bodyStart) {
            last = bodyStart - 1;   // the body consists of comments only
        } else if (k < last && isEmptyLine(lines[k])) {
            last = k;
            while (last >= bodyStart && isEmptyLine(lines[last])) {
                last--;
            }
        }
        if (last >= bodyStart) {
            model.body = lines.slice(bodyStart, last + 1).join('\n');
            bodyRange = [j, last];
            lastContentLine = last;
        }
    }

    model.endLine = lastContentLine;
    return { model, segmentStart: start, segmentEnd: end, urlRange, headerRange, bodyRange };
}

function parseMetadata(leadingLines: string[]): RequestMetadataModel {
    const metadata: RequestMetadataModel = { noRedirect: false, noCookieJar: false, prompts: [] };
    for (const line of leadingLines) {
        if (!isCommentLine(line)) {
            continue;
        }
        const m = line.match(RequestMetadataRegex);
        if (!m) {
            continue;
        }
        const key = m[1].toLowerCase();
        const value = m[2];
        switch (key) {
            case 'name': metadata.name = value ?? ''; break;
            case 'note': metadata.note = value ?? ''; break;
            case 'no-redirect': metadata.noRedirect = true; break;
            case 'no-cookie-jar': metadata.noCookieJar = true; break;
            case 'prompt': {
                const p = line.match(PromptCommentRegex);
                if (p) {
                    metadata.prompts.push({ name: p[1], description: p[2]?.trim() || undefined });
                }
                break;
            }
        }
    }
    return metadata;
}

function parseHeaderLine(line: string): KeyValue {
    if (isCommentLine(line)) {
        const m = line.match(disabledHeaderRegex);
        if (m) {
            return { key: m[1], value: m[2].trim(), enabled: false };
        }
        return { key: '', value: '', enabled: false, rawLine: line };
    }
    const separator = line.indexOf(':');
    if (separator === -1) {
        return { key: line.trim(), value: '', enabled: true };
    }
    return { key: line.substring(0, separator).trim(), value: line.substring(separator + 1).trim(), enabled: true };
}

function parseQueryPair(pair: string, enabled: boolean): KeyValue {
    const eq = pair.indexOf('=');
    return eq === -1
        ? { key: pair, value: '', enabled }
        : { key: pair.substring(0, eq), value: pair.substring(eq + 1), enabled };
}

// ---------------------------------------------------------------- serialization

export function serializeMetadata(metadata: RequestMetadataModel): string[] {
    const lines: string[] = [];
    if (metadata.name !== undefined && metadata.name.trim()) {
        lines.push(`# @name ${metadata.name.trim()}`);
    }
    if (metadata.note !== undefined) {
        lines.push(metadata.note.trim() ? `# @note ${metadata.note.trim()}` : '# @note');
    }
    if (metadata.noRedirect) {
        lines.push('# @no-redirect');
    }
    if (metadata.noCookieJar) {
        lines.push('# @no-cookie-jar');
    }
    for (const p of metadata.prompts) {
        if (p.name.trim()) {
            lines.push(`# @prompt ${p.name.trim()}${p.description?.trim() ? ' ' + p.description.trim() : ''}`);
        }
    }
    return lines;
}

function serializeRequestLine(request: HttpRequestModel, multiline: boolean): string[] {
    if (request.curl !== undefined) {
        return request.curl.split(/\r?\n/);
    }
    const method = (request.method || 'GET').toUpperCase();
    const url = request.url.trim();
    const disabled = request.disabledParams.filter(p => p.key || p.value);
    if (!multiline && disabled.length === 0) {
        return [`${method} ${url}${request.httpVersion ? ' ' + request.httpVersion : ''}`];
    }

    // One query param per line. The HTTP version is dropped here because REST Client strips
    // everything after ` HTTP/` from the joined URL.
    const queryIndex = url.indexOf('?');
    const base = queryIndex === -1 ? url : url.substring(0, queryIndex);
    const query = queryIndex === -1 ? '' : url.substring(queryIndex + 1);
    const lines = [`${method} ${base}`];
    let first = true;
    for (const pair of query.split('&').filter(Boolean)) {
        lines.push(`    ${first ? '?' : '&'}${pair}`);
        first = false;
    }
    for (const p of disabled) {
        lines.push(`    # ${first ? '?' : '&'}${p.key}${p.value || p.key.includes('=') ? '=' + p.value : ''}`);
    }
    return lines;
}

function serializeHeaders(headers: KeyValue[]): string[] {
    const lines: string[] = [];
    for (const h of headers) {
        if (h.rawLine !== undefined) {
            lines.push(h.rawLine);
        } else if (h.key.trim()) {
            lines.push(`${h.enabled ? '' : '# '}${h.key.trim()}: ${h.value}`);
        }
    }
    return lines;
}

function serializeBody(body: string): string[] {
    return body.trim() ? ['', ...body.split(/\r?\n/)] : [];
}

/** Serializes a request from scratch: title delimiter excluded. */
export function serializeRequest(request: HttpRequestModel): string[] {
    return [
        ...serializeMetadata(request.metadata),
        ...serializeRequestLine(request, false),
        ...(request.curl === undefined ? serializeHeaders(request.headers) : []),
        ...(request.curl === undefined ? serializeBody(request.body) : []),
    ];
}

function delimiterFor(title?: string): string {
    return title?.trim() ? `### ${title.trim()}` : '###';
}

// ---------------------------------------------------------------- edits

const json = (v: unknown) => JSON.stringify(v);

function sameUrl(a: HttpRequestModel, b: HttpRequestModel): boolean {
    return a.curl === b.curl && a.method.toUpperCase() === b.method.toUpperCase() && a.url === b.url
        && a.httpVersion === b.httpVersion && json(a.disabledParams) === json(b.disabledParams);
}

function sameHeaders(a: KeyValue[], b: KeyValue[]): boolean {
    const norm = (list: KeyValue[]) => list
        .filter(h => h.rawLine !== undefined || h.key.trim())
        .map(h => ({ key: h.key.trim(), value: h.value, enabled: h.enabled, rawLine: h.rawLine }));
    return json(norm(a)) === json(norm(b));
}

function sameMetadata(a: RequestMetadataModel, b: RequestMetadataModel): boolean {
    return json(serializeMetadata(a)) === json(serializeMetadata(b));
}

function join(lines: string[], eol: string) {
    return lines.join(eol);
}

/** Replaces request `index` with `next`, rewriting only the parts that changed. */
export function updateRequest(text: string, index: number, next: HttpRequestModel): string {
    const file = parseDetailed(text);
    const detail = file.requests[index];
    if (!detail) {
        throw new Error(`Request #${index + 1} no longer exists`);
    }
    const { lines } = file;
    const current = detail.model;
    const slice = ([s, e]: Range) => lines.slice(s, e + 1);

    let leading = lines.slice(detail.segmentStart, current.startLine);
    if (!sameMetadata(current.metadata, next.metadata)) {
        leading = [...leading.filter(l => !isKnownMetadataLine(l)), ...serializeMetadata(next.metadata)];
    }

    let requestLines: string[];
    if (next.curl !== undefined || current.curl !== undefined) {
        requestLines = next.curl === current.curl ? slice(detail.urlRange) : serializeRequestLine(next, false);
        if (next.curl === undefined) {
            requestLines.push(...serializeHeaders(next.headers), ...serializeBody(next.body));
        }
    } else {
        const wasMultiline = detail.urlRange[1] > detail.urlRange[0];
        requestLines = [
            ...(sameUrl(current, next) ? slice(detail.urlRange) : serializeRequestLine(next, wasMultiline)),
            ...(sameHeaders(current.headers, next.headers) ? slice(detail.headerRange) : serializeHeaders(next.headers)),
            ...(current.body === next.body ? slice(detail.bodyRange) : serializeBody(next.body)),
        ];
    }

    const result = [...lines];
    result.splice(detail.segmentStart, current.endLine - detail.segmentStart + 1, ...leading, ...requestLines);

    const titleChanged = (current.title ?? '') !== (next.title?.trim() ?? '');
    if (titleChanged) {
        if (current.delimiterLine !== undefined) {
            result[current.delimiterLine] = delimiterFor(next.title);
        } else if (next.title?.trim()) {
            result.splice(detail.segmentStart, 0, delimiterFor(next.title));
        }
    }
    return join(result, file.eol);
}

/** Appends a request (or inserts it after request `afterIndex`). */
export function addRequest(text: string, request: HttpRequestModel, afterIndex?: number): string {
    const file = parseDetailed(text);
    const lines = [...file.lines];
    const block = [delimiterFor(request.title), ...serializeRequest(request)];

    const after = afterIndex !== undefined ? file.requests[afterIndex] : undefined;
    if (after) {
        const insertAt = after.segmentEnd + 1;
        const prevLine = lines[insertAt - 1];
        const prefix = prevLine !== undefined && !isEmptyLine(prevLine) ? [''] : [];
        lines.splice(insertAt, 0, ...prefix, ...block, ...(insertAt < lines.length ? [''] : []));
        return join(lines, file.eol);
    }

    // Append to the end of the file. A file without requests and delimiters gets no leading `###`.
    while (lines.length > 0 && isEmptyLine(lines[lines.length - 1])) {
        lines.pop();
    }
    const firstBlock = lines.length === 0 || file.requests.length === 0 && !file.segments.some(s => s.delimiterLine !== undefined);
    if (lines.length > 0) {
        lines.push('');
    }
    lines.push(...(firstBlock && !request.title?.trim() ? block.slice(1) : block), '');
    return join(lines, file.eol);
}

export function duplicateRequest(text: string, index: number): string {
    const file = parseDetailed(text);
    const detail = file.requests[index];
    if (!detail) {
        return text;
    }
    const source = detail.model;
    const copy: HttpRequestModel = {
        ...source,
        title: `${source.title || displayName(source)} copy`,
        metadata: { ...source.metadata, name: undefined },
    };
    return addRequest(text, copy, index);
}

export function deleteRequest(text: string, index: number): string {
    const file = parseDetailed(text);
    const detail = file.requests[index];
    if (!detail) {
        return text;
    }
    const from = detail.model.delimiterLine ?? detail.segmentStart;
    const to = detail.segmentEnd;
    // keep file variables defined in the deleted segment
    const keep = file.lines.slice(from, to + 1).filter(isFileVariableLine);
    const lines = [...file.lines];
    lines.splice(from, to - from + 1, ...keep, ...(keep.length ? [''] : []));
    while (lines.length > 1 && isEmptyLine(lines[lines.length - 1]) && isEmptyLine(lines[lines.length - 2])) {
        lines.pop();
    }
    return join(lines, file.eol);
}

/** Moves request `from` so it ends up at position `to` among the requests. */
export function moveRequest(text: string, from: number, to: number): string {
    const file = parseDetailed(text);
    if (from === to || !file.requests[from] || !file.requests[to]) {
        return text;
    }
    const chunks = file.segments.map(s => ({
        lines: file.lines.slice(s.delimiterLine ?? s.start, s.end + 1),
        hasDelimiter: s.delimiterLine !== undefined,
        request: s.request,
    }));
    const fromChunk = chunks.findIndex(c => c.request === file.requests[from]);
    const [moving] = chunks.splice(fromChunk, 1);
    let toChunk = chunks.findIndex(c => c.request === file.requests[to]);
    if (to > from) {
        toChunk++;
    }
    chunks.splice(toChunk, 0, moving);

    const out: string[] = [];
    chunks.forEach((chunk, i) => {
        let chunkLines = chunk.lines;
        if (i > 0 && !chunk.hasDelimiter) {
            chunkLines = ['###', ...chunkLines];
        }
        if (i < chunks.length - 1 && chunkLines.length > 0 && !isEmptyLine(chunkLines[chunkLines.length - 1])) {
            chunkLines = [...chunkLines, ''];
        }
        out.push(...chunkLines);
    });
    return join(out, file.eol);
}

/**
 * Rewrites the `@name = value` lines: existing variables (with `line`) are updated in place,
 * missing ones are deleted and new ones are inserted after the last variable at the top of the file.
 */
export function updateFileVariables(text: string, variables: FileVariable[]): string {
    const file = parseDetailed(text);
    const lines = [...file.lines];
    const byLine = new Map(variables.filter(v => v.line !== undefined).map(v => [v.line!, v]));

    const edits = file.fileVariables
        .map(v => ({ line: v.line!, next: byLine.get(v.line!) }))
        .sort((a, b) => b.line - a.line);
    for (const { line, next } of edits) {
        if (!next) {
            lines.splice(line, 1);
        } else if (next.key.trim()) {
            const original = file.lines[line];
            const m = original.match(FileVariableDefinitionRegex);
            if (!m || m[1] !== next.key.trim() || m[2] !== next.value) {
                lines[line] = `@${next.key.trim()} = ${next.value}`;
            }
        }
    }

    const added = variables.filter(v => v.line === undefined && v.key.trim()).map(v => `@${v.key.trim()} = ${v.value}`);
    if (added.length) {
        // insert after the last variable line of the first segment, or at the top of the file
        const reparsed = parseDetailed(join(lines, file.eol));
        const first = reparsed.segments[0];
        const firstEnd = first.request ? first.request.model.startLine - 1 : first.end;
        const lastVar = reparsed.fileVariables.filter(v => v.line! <= firstEnd).pop();
        if (lastVar) {
            lines.splice(lastVar.line! + 1, 0, ...added);
        } else {
            lines.splice(0, 0, ...added, ...(lines.length && !isEmptyLine(lines[0]) ? [''] : []));
        }
    }
    return join(lines, file.eol);
}

export function displayName(request: HttpRequestModel): string {
    if (request.title) {
        return request.title;
    }
    if (request.metadata.name) {
        return request.metadata.name;
    }
    if (request.curl !== undefined) {
        return request.curl.split('\n')[0].substring(0, 60);
    }
    return `${request.method} ${request.url}`;
}

/** The raw text block of request `index` (segment between delimiters), as REST Client would select it. */
export function getRequestBlockText(text: string, index: number): { text: string; startLine: number } | undefined {
    const file = parseDetailed(text);
    const detail = file.requests[index];
    if (!detail) {
        return undefined;
    }
    return {
        text: file.lines.slice(detail.segmentStart, detail.segmentEnd + 1).join(file.eol),
        startLine: detail.segmentStart,
    };
}

/** Computes the smallest single replacement that turns `before` into `after`. */
export function minimalEdit(before: string, after: string): { start: number; end: number; text: string } | undefined {
    if (before === after) {
        return undefined;
    }
    let start = 0;
    const minLength = Math.min(before.length, after.length);
    while (start < minLength && before[start] === after[start]) {
        start++;
    }
    let endBefore = before.length;
    let endAfter = after.length;
    while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
        endBefore--;
        endAfter--;
    }
    // don't split a CRLF pair
    if (start > 0 && before[start - 1] === '\r' && before[start] === '\n') {
        start--;
    }
    if (endBefore < before.length && before[endBefore - 1] === '\r' && before[endBefore] === '\n') {
        endBefore++;
        endAfter++;
    }
    return { start, end: endBefore, text: after.substring(start, endAfter) };
}

export function emptyRequest(): HttpRequestModel {
    return {
        title: 'New Request',
        metadata: { noRedirect: false, noCookieJar: false, prompts: [] as PromptDefinition[] },
        method: 'GET',
        url: 'https://httpbin.org/get',
        disabledParams: [],
        headers: [],
        body: '',
    };
}
