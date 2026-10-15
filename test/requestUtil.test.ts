import { describe, expect, it } from 'vitest';
import {
    buildAuth, buildFileReference, buildFormBody, buildMultipartBody, detectBodyMode, getParams, joinGraphQl, parseAuth,
    parseFileReference, parseFormBody, parseMultipartBody, setHeader, setParams, splitGraphQl
} from '../src/shared/requestUtil';
import { HttpRequestModel } from '../src/shared/types';

const base: HttpRequestModel = {
    metadata: { noRedirect: false, noCookieJar: false, prompts: [] },
    method: 'GET',
    url: '{{host}}/items?page=1&q={{term}}',
    disabledParams: [{ key: 'debug', value: 'true', enabled: false }],
    headers: [],
    body: '',
};

describe('params', () => {
    it('round trips enabled and disabled params', () => {
        const params = getParams(base);
        expect(params.map(p => [p.key, p.value, p.enabled])).toEqual([['page', '1', true], ['q', '{{term}}', true], ['debug', 'true', false]]);
        const toggled = params.map(p => p.key === 'page' ? { ...p, enabled: false } : p.key === 'debug' ? { ...p, enabled: true } : p);
        const next = setParams(base, toggled);
        expect(next.url).toBe('{{host}}/items?q={{term}}&debug=true');
        expect(next.disabledParams).toEqual([{ key: 'page', value: '1', enabled: false }]);
    });
});

describe('auth', () => {
    it('parses and builds supported schemes', () => {
        expect(parseAuth('Basic user pass word')).toEqual({ type: 'basic', username: 'user', password: 'pass word' });
        expect(parseAuth('Basic user:pw')).toEqual({ type: 'basic', username: 'user', password: 'pw' });
        expect(parseAuth('Basic dXNlcjpwdw==')).toEqual({ type: 'custom', raw: 'Basic dXNlcjpwdw==' });
        expect(parseAuth('Bearer {{token}}')).toEqual({ type: 'bearer', token: '{{token}}' });
        const aws = parseAuth('AWS id secret token:t region:us-east-1 service:s3');
        expect(aws).toMatchObject({ type: 'aws', accessKeyId: 'id', secretAccessKey: 'secret', sessionToken: 't', region: 'us-east-1', service: 's3' });
        expect(buildAuth(aws)).toBe('AWS id secret token:t region:us-east-1 service:s3');
        expect(buildAuth({ type: 'digest', username: 'u', password: 'p' })).toBe('Digest u p');
        expect(buildAuth({ type: 'none' })).toBeUndefined();
    });

    it('sets and removes headers', () => {
        const headers = setHeader([{ key: 'Accept', value: '*/*', enabled: true }], 'authorization', 'Bearer x');
        expect(headers).toEqual([{ key: 'Accept', value: '*/*', enabled: true }, { key: 'authorization', value: 'Bearer x', enabled: true }]);
        expect(setHeader(headers, 'Authorization', undefined)).toHaveLength(1);
    });
});

describe('body', () => {
    it('detects body modes', () => {
        const withHeader = (key: string, value: string, body = 'x') => ({ ...base, headers: [{ key, value, enabled: true }], body });
        expect(detectBodyMode(base)).toBe('none');
        expect(detectBodyMode(withHeader('Content-Type', 'application/json'))).toBe('raw');
        expect(detectBodyMode(withHeader('Content-Type', 'application/x-www-form-urlencoded'))).toBe('form-urlencoded');
        expect(detectBodyMode(withHeader('Content-Type', 'multipart/form-data; boundary=x'))).toBe('multipart');
        expect(detectBodyMode(withHeader('X-Request-Type', 'GraphQL'))).toBe('graphql');
        expect(detectBodyMode(withHeader('Content-Type', 'image/png', '< ./a.png'))).toBe('file');
    });

    it('round trips form bodies', () => {
        const rows = parseFormBody('a=1\n&b={{x}}\n# &c=3');
        expect(rows).toEqual([
            { key: 'a', value: '1', enabled: true },
            { key: 'b', value: '{{x}}', enabled: true },
            { key: 'c', value: '3', enabled: false },
        ]);
        expect(buildFormBody(rows)).toBe('a=1\n&b={{x}}\n# &c=3');
        expect(parseFormBody('a=1&b=2')).toHaveLength(2);
    });

    it('round trips multipart bodies', () => {
        const body = buildMultipartBody([
            { key: 'text', value: 'hello', type: 'text' },
            { key: 'file', value: './a.png', type: 'file', contentType: 'image/png' },
        ], 'B');
        expect(body).toBe([
            '--B', 'Content-Disposition: form-data; name="text"', '', 'hello',
            '--B', 'Content-Disposition: form-data; name="file"; filename="a.png"', 'Content-Type: image/png', '', '< ./a.png',
            '--B--',
        ].join('\n'));
        expect(parseMultipartBody(body, 'B')).toEqual([
            { key: 'text', value: 'hello', type: 'text', contentType: undefined },
            { key: 'file', value: './a.png', type: 'file', contentType: 'image/png' },
        ]);
        expect(parseMultipartBody('garbage', 'B')).toBeUndefined();
    });

    it('splits and joins graphql', () => {
        expect(splitGraphQl('query {\n  a\n}\n\n{"x":1}')).toEqual({ query: 'query {\n  a\n}', variables: '{"x":1}' });
        expect(joinGraphQl('query {\n\n  a\n}', '{"x":1}')).toBe('query {\n  a\n}\n\n{"x":1}');
    });

    it('parses file references', () => {
        expect(parseFileReference('<@latin1 ./a.json')).toEqual({ path: './a.json', processVariables: true, encoding: 'latin1' });
        expect(parseFileReference('< ./a.bin')).toEqual({ path: './a.bin', processVariables: false, encoding: undefined });
        expect(buildFileReference('./a.json', true)).toBe('<@ ./a.json');
    });
});
