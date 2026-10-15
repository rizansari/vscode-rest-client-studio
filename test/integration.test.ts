import * as fs from 'fs';
import * as http from 'http';
import { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CodegenService } from '../src/extension/services/codegenService';
import { CookieService } from '../src/extension/services/cookieService';
import { HistoryService } from '../src/extension/services/historyService';
import { CancelledError, RequestRunner } from '../src/extension/services/requestRunner';
import { EnvironmentService } from '../src/extension/services/environmentService';
import { listVariables } from '../src/extension/services/variableService';
import { answers, configuration, createDocument, Uri } from './vscodeStub';

let server: http.Server;
let base: string;

beforeAll(async () => {
    server = http.createServer((req, res) => {
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(c));
        req.on('end', () => {
            const body = Buffer.concat(chunks).toString();
            const url = new URL(req.url!, 'http://localhost');
            if (url.pathname === '/login') {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Set-Cookie', 'session=s3cret; Path=/');
                res.end(JSON.stringify({ token: 'tok-123', nested: { id: 7 } }));
                return;
            }
            if (url.pathname === '/redirect') {
                res.statusCode = 302;
                res.setHeader('Location', '/echo');
                res.end();
                return;
            }
            if (url.pathname === '/basic') {
                const ok = req.headers.authorization === `Basic ${Buffer.from('user:pa ss').toString('base64')}`;
                res.statusCode = ok ? 200 : 401;
                res.end(ok ? 'ok' : 'denied');
                return;
            }
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.end(JSON.stringify({ method: req.method, path: url.pathname, query: url.search, headers: req.headers, body }));
        });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
    server.close();
});

let documentCounter = 0;

function setup(text: string) {
    // documents live next to payload.json; unique names keep REST Client's per-document caches apart
    const dir = path.join(__dirname, 'fixtures');
    const document = createDocument(path.join(dir, `integration-${documentCounter++}.http`), text) as any;
    const storage = fs.mkdtempSync(path.join(os.tmpdir(), 'studio-history-'));
    const cookies = new CookieService();
    const history = new HistoryService(Uri.file(storage) as any);
    const runner = new RequestRunner(cookies, history);
    return { document, runner, history, cookies };
}

describe('request pipeline', () => {
    it('resolves file, environment, prompt and system variables', async () => {
        configuration['rest-client'].environmentVariables = {
            $shared: { version: 'v1' },
            local: { host: base, apiVersion: '{{$shared version}}' },
        };
        await new EnvironmentService().select('local');
        const { document, runner } = setup([
            '@path = echo',
            '@full = {{host}}/{{path}}',
            '',
            '### Echo',
            '# @prompt user Your name',
            'POST {{full}}?v={{apiVersion}}&id={{$guid}}',
            'Content-Type: application/json',
            'X-User: {{user}}',
            '# X-Disabled: nope',
            '',
            '{"n": {{$randomInt 5 6}}}',
        ].join('\n'));
        answers.inputBox = ['alice'];
        const response = await runner.send(document, 0);
        const echoed = JSON.parse(response.body);
        expect(response.statusCode).toBe(200);
        expect(echoed.method).toBe('POST');
        expect(echoed.path).toBe('/echo');
        expect(echoed.query).toMatch(/^\?v=v1&id=[0-9a-f-]{36}$/);
        expect(echoed.headers['x-user']).toBe('alice');
        expect(echoed.headers['x-disabled']).toBeUndefined();
        expect(echoed.headers['user-agent']).toBe('vscode-restclient');
        expect(echoed.body).toBe('{"n": 5}');
        expect(response.prettyBody).toContain('\n');
        expect(response.timings.total).toBeGreaterThan(0);
    });

    it('chains named requests and stores cookies', async () => {
        configuration['rest-client'].environmentVariables = {};
        const { document, runner, cookies } = setup([
            `@host = ${base}`,
            '###',
            '# @name login',
            'POST {{host}}/login',
            '',
            '###',
            'GET {{host}}/echo',
            'Authorization: Bearer {{login.response.body.$.token}}',
            'X-Id: {{login.response.body.$.nested.id}}',
        ].join('\n'));
        const before = (await listVariables(document)).find(v => v.name === 'login');
        expect(before).toMatchObject({ source: 'request', sent: false });

        await runner.send(document, 0);
        const echoed = JSON.parse((await runner.send(document, 1)).body);
        expect(echoed.headers.authorization).toBe('Bearer tok-123');
        expect(echoed.headers['x-id']).toBe('7');
        expect(echoed.headers.cookie).toBe('session=s3cret');

        const after = (await listVariables(document)).find(v => v.name === 'login');
        expect(after?.sent).toBe(true);
        expect((await cookies.list()).map(c => c.key)).toContain('session');
        await cookies.clear();
        expect(await cookies.list()).toHaveLength(0);
    });

    it('sends form, file, graphql and curl bodies', async () => {
        const { document, runner } = setup([
            `@host = ${base}`,
            '@user = bob',
            '###',
            'POST {{host}}/echo',
            'Content-Type: application/x-www-form-urlencoded',
            '',
            'a=1 2',
            '&b={{user}}',
            '# &c=3',
            '###',
            'POST {{host}}/echo',
            'Content-Type: application/json',
            '',
            '<@ ./payload.json',
            '###',
            'POST {{host}}/echo',
            'X-Request-Type: GraphQL',
            'Content-Type: application/json',
            '',
            'query Q($id: ID!) { node(id: $id) { id } }',
            '',
            '{"id": "{{user}}"}',
            '###',
            `curl -X PUT "${base}/echo" -H "X-Curl: yes" --data-raw "x=1"`,
        ].join('\n'));
        const form = JSON.parse((await runner.send(document, 0)).body);
        expect(form.body).toBe('a=1%202&b=bob');

        const file = JSON.parse((await runner.send(document, 1)).body);
        expect(JSON.parse(file.body)).toEqual({ user: 'bob' });

        const graphql = JSON.parse((await runner.send(document, 2)).body);
        expect(JSON.parse(graphql.body)).toEqual({ query: 'query Q($id: ID!) { node(id: $id) { id } }', operationName: 'Q', variables: { id: 'bob' } });
        expect(graphql.headers['x-request-type']).toBeUndefined();

        const curl = JSON.parse((await runner.send(document, 3)).body);
        expect(curl.method).toBe('PUT');
        expect(curl.headers['x-curl']).toBe('yes');
        expect(curl.body).toBe('x=1');
    });

    it('honours @no-redirect, basic auth and @note', async () => {
        const { document, runner, history } = setup([
            `@host = ${base}`,
            '###',
            '# @no-redirect',
            'GET {{host}}/redirect',
            '###',
            'GET {{host}}/redirect',
            '###',
            'GET {{host}}/basic',
            'Authorization: Basic user pa ss',
            '###',
            '# @note dangerous',
            'DELETE {{host}}/echo',
        ].join('\n'));
        expect((await runner.send(document, 0)).statusCode).toBe(302);
        expect((await runner.send(document, 1)).statusCode).toBe(200);
        expect((await runner.send(document, 2)).body).toBe('ok');

        answers.warning = undefined;
        await expect(runner.send(document, 3)).rejects.toBeInstanceOf(CancelledError);
        answers.warning = 'Send';
        expect((await runner.send(document, 3)).statusCode).toBe(200);

        const entries = await history.getAll();
        expect(entries[0]).toMatchObject({ method: 'DELETE', statusCode: 200, title: 'DELETE {{host}}/echo' });
        expect(entries[0].requestText).toBe('DELETE {{host}}/echo');
    });

    it('generates code snippets from the resolved request', async () => {
        const { document, runner } = setup([
            `@host = ${base}`,
            'POST {{host}}/echo?x=1',
            'Authorization: Basic u p',
            'Content-Type: application/json',
            '',
            '{"a": 1}',
        ].join('\n'));
        const { httpRequest } = await runner.prepare(document, 0);
        const curl = new CodegenService().generate(httpRequest, 'shell', 'curl');
        expect(curl).toContain(`${base}/echo?x=1`);
        expect(curl).toContain(`Basic ${Buffer.from('u:p').toString('base64')}`);
        expect(curl).toContain('{"a": 1}');
    });

    it('reports connection errors', async () => {
        const { document, runner, history } = setup('GET http://127.0.0.1:1/nothing');
        await expect(runner.send(document, 0)).rejects.toThrow(/ECONNREFUSED/);
        expect((await history.getAll())[0].error).toMatch(/ECONNREFUSED/);
    });
});
