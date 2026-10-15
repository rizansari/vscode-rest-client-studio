import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import {
    addRequest, deleteRequest, duplicateRequest, emptyRequest, minimalEdit, moveRequest, parseHttpFile,
    updateFileVariables, updateRequest
} from '../src/extension/model/httpFile';

const sample = fs.readFileSync(path.join(__dirname, 'fixtures/sample.http'), 'utf8');
const crlf = sample.replace(/\n/g, '\r\n');

describe('parseHttpFile', () => {
    const file = parseHttpFile(sample);

    it('finds requests and file variables', () => {
        expect(file.requests.map(r => r.title ?? null)).toEqual(['Get things', 'Create', null, 'GraphQL', 'curl', 'Upload']);
        expect(file.fileVariables.map(v => [v.key, v.value])).toEqual([['baseUrl', 'https://httpbin.org'], ['token', 'abc\\n123']]);
    });

    it('parses multi-line urls, disabled params and headers', () => {
        const r = file.requests[0];
        expect(r.metadata.name).toBe('getThings');
        expect(r.method).toBe('GET');
        expect(r.url).toBe('{{baseUrl}}/get?page=1&size={{size}}');
        expect(r.disabledParams).toEqual([{ key: 'debug', value: 'true', enabled: false }]);
        expect(r.headers).toEqual([
            { key: 'Accept', value: 'application/json', enabled: true },
            { key: 'X-Disabled', value: 'yes', enabled: false },
        ]);
        expect(r.body).toBe('');
    });

    it('parses metadata, version and body, excluding detached trailing comments', () => {
        const r = file.requests[1];
        expect(r.metadata.note).toBe('');
        expect(r.httpVersion).toBe('HTTP/1.1');
        expect(r.body).toBe('{\n  "name": "x"\n}');
    });

    it('keeps attached comment lines in the body', () => {
        expect(file.requests[2].body).toBe('a=1\n&b=2\n# &c=3');
    });

    it('handles graphql, curl and pasted responses', () => {
        expect(file.requests[3].body).toBe('query Q($id: ID!) { node(id: $id) { id } }\n\n{ "id": "1" }');
        expect(file.requests[4].curl).toBe('curl -X GET "https://httpbin.org/anything" -H "Accept: */*"');
        expect(file.requests[5].body).toBe('< ./payload.bin');
    });

    it('detects CRLF', () => {
        expect(parseHttpFile(crlf).eol).toBe('\r\n');
        expect(parseHttpFile(crlf).requests[1].body).toBe('{\n  "name": "x"\n}');
    });
});

describe('round trip', () => {
    for (const [name, text] of [['LF', sample], ['CRLF', crlf]] as const) {
        it(`updating every request with its own model is a no-op (${name})`, () => {
            const file = parseHttpFile(text);
            let result = text;
            file.requests.forEach((r, i) => {
                result = updateRequest(result, i, r);
            });
            expect(result).toBe(text);
        });
    }
});

describe('edits', () => {
    const file = parseHttpFile(sample);

    it('changes only the header block', () => {
        const r = file.requests[1];
        const next = { ...r, headers: [...r.headers, { key: 'X-New', value: '1', enabled: true }] };
        const result = updateRequest(sample, 1, next);
        expect(result).toBe(sample.replace('Authorization: Bearer {{token}}\n', 'Authorization: Bearer {{token}}\nX-New: 1\n'));
    });

    it('rewrites the url and keeps multi-line style', () => {
        const r = file.requests[0];
        const result = updateRequest(sample, 0, { ...r, url: '{{baseUrl}}/get?page=2', disabledParams: [] });
        expect(result).toContain('GET {{baseUrl}}/get\n    ?page=2\nAccept: application/json');
        expect(parseHttpFile(result).requests[0].url).toBe('{{baseUrl}}/get?page=2');
    });

    it('writes disabled params as commented continuation lines', () => {
        const r = file.requests[1];
        const result = updateRequest(sample, 1, { ...r, disabledParams: [{ key: 'q', value: 'x', enabled: false }] });
        const reparsed = parseHttpFile(result).requests[1];
        expect(reparsed.url).toBe('{{baseUrl}}/post');
        expect(reparsed.disabledParams).toEqual([{ key: 'q', value: 'x', enabled: false }]);
        expect(reparsed.body).toBe(r.body);
    });

    it('updates metadata and title', () => {
        const r = file.requests[2];
        const result = updateRequest(sample, 2, { ...r, title: 'Form', metadata: { ...r.metadata, name: 'form', noRedirect: true } });
        expect(result).toContain('### Form\n# @name form\n# @no-redirect\nPOST {{baseUrl}}/post\n');
        const reparsed = parseHttpFile(result).requests[2];
        expect(reparsed.title).toBe('Form');
        expect(reparsed.metadata.name).toBe('form');
    });

    it('removes metadata', () => {
        const r = file.requests[0];
        const result = updateRequest(sample, 0, { ...r, metadata: { ...r.metadata, name: undefined } });
        expect(result).not.toContain('@name getThings');
        expect(result).toContain('// a description comment\nGET');
    });

    it('changes the body', () => {
        const r = file.requests[1];
        const result = updateRequest(sample, 1, { ...r, body: '{"a":1}' });
        expect(parseHttpFile(result).requests[1].body).toBe('{"a":1}');
        expect(result).toContain('{"a":1}\n\n# trailing comment for create');
    });

    it('adds, duplicates, deletes and moves requests', () => {
        const added = addRequest(sample, emptyRequest());
        expect(parseHttpFile(added).requests).toHaveLength(7);
        expect(parseHttpFile(added).requests[6].title).toBe('New Request');

        const dup = duplicateRequest(sample, 0);
        const dupFile = parseHttpFile(dup);
        expect(dupFile.requests).toHaveLength(7);
        expect(dupFile.requests[1].title).toBe('Get things copy');
        expect(dupFile.requests[1].metadata.name).toBeUndefined();
        expect(dupFile.requests[1].url).toBe(file.requests[0].url);

        const del = deleteRequest(sample, 1);
        expect(parseHttpFile(del).requests.map(r => r.title ?? null)).toEqual(['Get things', null, 'GraphQL', 'curl', 'Upload']);

        const moved = moveRequest(sample, 0, 2);
        expect(parseHttpFile(moved).requests.map(r => r.title ?? null)).toEqual(['Create', null, 'Get things', 'GraphQL', 'curl', 'Upload']);
        expect(parseHttpFile(moved).fileVariables).toHaveLength(2);
        const back = moveRequest(moved, 2, 0);
        expect(parseHttpFile(back).requests.map(r => r.title ?? null)).toEqual(['Get things', 'Create', null, 'GraphQL', 'curl', 'Upload']);
    });

    it('adds a request to an empty file', () => {
        expect(addRequest('', { ...emptyRequest(), title: undefined })).toBe('GET https://httpbin.org/get\n');
    });

    it('moves the first request of a file without delimiters', () => {
        const text = 'GET https://a\n\n###\nGET https://b\n';
        const moved = moveRequest(text, 0, 1);
        expect(parseHttpFile(moved).requests.map(r => r.url)).toEqual(['https://b', 'https://a']);
    });

    it('updates file variables', () => {
        const vars = file.fileVariables.map(v => ({ ...v }));
        vars[0].value = 'https://example.com';
        vars.splice(1, 1);
        vars.push({ key: 'size', value: '10' });
        const result = updateFileVariables(sample, vars);
        expect(result.startsWith('@baseUrl = https://example.com\n@size = 10\n\n### Get things')).toBe(true);
    });

    it('computes minimal edits', () => {
        expect(minimalEdit('abcdef', 'abXYef')).toEqual({ start: 2, end: 4, text: 'XY' });
        expect(minimalEdit('same', 'same')).toBeUndefined();
    });
});
