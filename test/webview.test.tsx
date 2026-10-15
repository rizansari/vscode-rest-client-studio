// @vitest-environment jsdom
import * as fs from 'fs';
import * as path from 'path';
import { act } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseHttpFile } from '../src/extension/model/httpFile';
import { ResponseModel, WebviewToHost } from '../src/shared/types';

const posted: WebviewToHost[] = [];
let state: unknown;
vi.stubGlobal('acquireVsCodeApi', () => ({
    postMessage: (m: WebviewToHost) => posted.push(m),
    getState: () => state,
    setState: (s: unknown) => { state = s; },
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// CodeMirror measures layout, which jsdom doesn't implement
const rect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON() { return this; } };
Range.prototype.getBoundingClientRect = () => rect as DOMRect;
Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as any;

const sample = fs.readFileSync(path.join(__dirname, 'fixtures/sample.http'), 'utf8');

let root: Root;
let container: HTMLDivElement;
let store: typeof import('../webview/src/store');

function $(selector: string) {
    return container.querySelector(selector) as HTMLElement;
}

function $$(selector: string) {
    return [...container.querySelectorAll(selector)] as HTMLElement[];
}

function click(el: Element | null | undefined) {
    expect(el).toBeTruthy();
    act(() => { (el as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true })); });
}

function type(input: HTMLInputElement, value: string) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
}

function byText(selector: string, text: string) {
    return $$(selector).find(el => el.textContent?.trim().startsWith(text));
}

beforeAll(async () => {
    store = await import('../webview/src/store');
    const { App } = await import('../webview/src/App');
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<App />));
    act(() => store.handleHostMessage({
        type: 'init',
        fileName: 'sample.http',
        file: parseHttpFile(sample),
        env: { names: ['dev', 'prod'], current: 'dev', variables: { dev: { size: '10' } } },
        variables: [
            { name: 'baseUrl', value: 'https://httpbin.org', source: 'file' },
            { name: 'size', value: '10', source: 'environment' },
            { name: 'getThings', source: 'request', sent: false },
            { name: '$guid', source: 'system' },
        ],
        codegenTargets: [{ key: 'shell', title: 'Shell', clients: [{ key: 'curl', title: 'cURL' }] }],
        config: { responsePane: 'bottom' },
    }));
});

afterAll(() => {
    act(() => root.unmount());
});

describe('webview', () => {
    it('renders the request list and the selected request', () => {
        const names = $$('.request-item-name').map(e => e.textContent);
        expect(names).toEqual(['Get things', 'Create', '{{baseUrl}}/post', 'GraphQL', 'curl', 'Upload']);
        expect(($('.url-input input') as HTMLInputElement).value).toBe('{{baseUrl}}/get?page=1&size={{size}}');
        expect($('.env-picker select') as HTMLSelectElement).toHaveProperty('value', 'dev');
        // variables are highlighted
        expect($$('.url-input .var-ok').map(e => e.textContent)).toEqual(['{{baseUrl}}', '{{size}}']);
    });

    it('shows params including disabled ones and edits the url', async () => {
        const keys = $$('.kv-table tbody tr td:nth-child(2) input').map(i => (i as HTMLInputElement).value);
        expect(keys).toEqual(['page', 'size', 'debug', '']);
        // disable "page"
        const checkbox = $$('.kv-table tbody input[type="checkbox"]')[0] as HTMLInputElement;
        act(() => checkbox.click());
        expect(($('.url-input input') as HTMLInputElement).value).toBe('{{baseUrl}}/get?size={{size}}');

        posted.length = 0;
        await act(() => new Promise(r => setTimeout(r, 350)));
        const update = posted.find(m => m.type === 'updateRequest') as Extract<WebviewToHost, { type: 'updateRequest' }>;
        expect(update.index).toBe(0);
        expect(update.request.disabledParams.map(p => p.key)).toEqual(['page', 'debug']);
    });

    it('switches between tabs', () => {
        click(byText('.tab', 'Headers'));
        expect($$('.kv-table tbody tr td:nth-child(2) input').map(i => (i as HTMLInputElement).value)).toEqual(['Accept', 'X-Disabled', '']);
        click(byText('.tab', 'Authorization'));
        expect(($('.auth-type select') as HTMLSelectElement).value).toBe('none');
        click(byText('.tab', 'Settings'));
        expect(($('.settings input') as HTMLInputElement).value).toBe('getThings');
        click(byText('.tab', 'Body'));
        expect(($('.body-modes input:checked') as HTMLInputElement).parentElement!.textContent).toBe('none');
    });

    it('edits auth on another request', () => {
        click($$('.request-item')[1]);
        expect(($('.url-input input') as HTMLInputElement).value).toBe('{{baseUrl}}/post');
        click(byText('.tab', 'Authorization'));
        expect(($('.auth-type select') as HTMLSelectElement).value).toBe('bearer');
        const select = $('.auth-type select') as HTMLSelectElement;
        act(() => {
            select.value = 'basic';
            select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        const user = $$('.auth-fields input')[0] as HTMLInputElement;
        type(user, 'alice');
        expect(store.useStudio.getState().draft!.headers.find(h => h.key === 'Authorization')!.value).toBe('Basic alice');
    });

    it('shows form and graphql body editors', () => {
        click($$('.request-item')[2]);
        click(byText('.tab', 'Body'));
        expect(($('.body-modes input:checked') as HTMLInputElement).parentElement!.textContent).toBe('x-www-form-urlencoded');
        expect($$('.kv-table tbody tr td:nth-child(2) input').map(i => (i as HTMLInputElement).value)).toEqual(['a', 'b', 'c', '']);
        click($$('.request-item')[3]);
        expect(($('.body-modes input:checked') as HTMLInputElement).parentElement!.textContent).toBe('GraphQL');
        expect($$('.graphql .code-editor')).toHaveLength(2);
        click($$('.request-item')[4]);
        expect($('.curl-label')).toBeTruthy();
    });

    it('renders a response', () => {
        click($$('.request-item')[0]);
        posted.length = 0;
        click($('.send-button'));
        expect(posted.some(m => m.type === 'send' && m.index === 0)).toBe(true);
        act(() => store.handleHostMessage({ type: 'requestStarted', index: 0 }));
        expect($('.response-loading')).toBeTruthy();
        const response: ResponseModel = {
            statusCode: 200, statusMessage: 'OK', httpVersion: '1.1',
            headers: [['Content-Type', 'application/json'], ['Set-Cookie', 'a=b; Path=/; HttpOnly']],
            contentType: 'application/json', body: '{"ok":true}', prettyBody: '{\n  "ok": true\n}',
            bodySize: 11, headersSize: 60, truncated: false,
            timings: { wait: 1, dns: 2, tcp: 3, request: 1, firstByte: 20, download: 1, total: 28 },
            durationMs: 30, request: { method: 'GET', url: 'https://httpbin.org/get', headers: [['Accept', '*/*']] },
            receivedAt: Date.now(),
        };
        act(() => store.handleHostMessage({ type: 'requestFinished', index: 0, response }));
        expect($('.response-stats')!.textContent).toContain('200 OK');
        expect($('.response-stats')!.textContent).toContain('28 ms');
        click(byText('.response-tabs .tab', 'Cookies'));
        expect($$('.data-table tbody tr')).toHaveLength(1);
        click(byText('.response-tabs .tab', 'Timeline'));
        expect($$('.phase')).toHaveLength(7);
        click(byText('.response-tabs .tab', 'Headers'));
        expect($$('.data-table tbody tr')).toHaveLength(2);
    });

    it('applies external document changes and keeps responses per request', () => {
        const changed = sample.replace('### Create', '### Create user');
        act(() => store.handleHostMessage({ type: 'documentChanged', file: parseHttpFile(changed), source: 'external' }));
        expect($$('.request-item-name')[1].textContent).toBe('Create user');
        act(() => store.deleteRequest(0));
        expect(store.useStudio.getState().responses[0]).toBeUndefined();
    });

    it('opens the modals', () => {
        act(() => store.setModal('code'));
        expect(posted.some(m => m.type === 'generateCode')).toBe(true);
        act(() => store.handleHostMessage({ type: 'codeSnippet', target: 'shell', client: 'curl', code: 'curl x' }));
        expect($('.codegen-output')).toBeTruthy();
        act(() => store.setModal('env'));
        expect($$('.env-item').map(e => e.textContent)).toEqual(['$shared (all)', 'dev']);
        act(() => store.setModal('cookies'));
        expect($('.modal .empty-state')).toBeTruthy();
        act(() => store.setModal(null));
        expect($('.modal')).toBeNull();
    });
});
