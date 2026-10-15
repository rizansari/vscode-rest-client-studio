import { useMemo, useState } from 'react';
import { formatBytes } from '../../../src/shared/requestUtil';
import { ResponseModel } from '../../../src/shared/types';
import { cancel, send, useStudio } from '../store';
import { post } from '../vscode';
import { CodeEditor, EditorLanguage } from './CodeEditor';
import { Dropdown, EmptyState, Icon, IconButton, Tabs } from './common';

type ResponseTab = 'body' | 'cookies' | 'headers' | 'timeline';
type BodyView = 'pretty' | 'raw' | 'preview';

export function ResponsePane() {
    const state = useStudio(s => s.responses[s.selected]);
    const selected = useStudio(s => s.selected);
    const [tab, setTab] = useState<ResponseTab>('body');

    if (!state || (!state.response && !state.loading && !state.error)) {
        return (
            <div className="response-pane">
                <div className="response-header"><span className="response-title">Response</span></div>
                <EmptyState icon="rocket" title="Enter the URL and click Send to get a response">
                    <button type="button" className="secondary-button" onClick={() => send()}>Send request</button>
                </EmptyState>
            </div>
        );
    }

    const { response, loading, error } = state;
    const cookies = response ? parseSetCookies(response) : [];

    return (
        <div className="response-pane">
            <Tabs<ResponseTab>
                className="response-tabs"
                active={tab}
                onChange={setTab}
                tabs={[
                    { id: 'body', label: 'Body' },
                    { id: 'cookies', label: 'Cookies', badge: cookies.length },
                    { id: 'headers', label: 'Headers', badge: response?.headers.length ?? 0 },
                    { id: 'timeline', label: 'Timeline' },
                ]}
                right={response ? <ResponseStats response={response} index={selected} /> : null}
            />
            {loading && (
                <div className="response-loading">
                    <div className="spinner" />
                    <span>Sending request…</span>
                    <button type="button" className="secondary-button" onClick={() => cancel()}>Cancel</button>
                </div>
            )}
            {!loading && error && (
                <div className="response-error">
                    <Icon name="error" />
                    <div>
                        <div className="error-title">Could not get a response</div>
                        <pre>{error}</pre>
                    </div>
                </div>
            )}
            {!loading && !error && response && (
                <div className="response-content">
                    {tab === 'body' && <ResponseBody response={response} />}
                    {tab === 'headers' && <HeaderTable rows={response.headers} />}
                    {tab === 'cookies' && <CookieTable cookies={cookies} />}
                    {tab === 'timeline' && <Timeline response={response} />}
                </div>
            )}
        </div>
    );
}

function statusClass(code: number) {
    if (code >= 500) {
        return 'status-error';
    }
    if (code >= 400) {
        return 'status-warn';
    }
    if (code >= 300) {
        return 'status-redirect';
    }
    return 'status-ok';
}

function ResponseStats({ response, index }: { response: ResponseModel; index: number }) {
    return (
        <div className="response-stats">
            <span className="stat">Status: <b className={statusClass(response.statusCode)}>{response.statusCode} {response.statusMessage}</b></span>
            <span className="stat" title={timingTitle(response)}>Time: <b className="status-ok">{Math.round(response.timings.total ?? response.durationMs)} ms</b></span>
            <span className="stat" title={`Headers: ${formatBytes(response.headersSize)}\nBody: ${formatBytes(response.bodySize)}`}>
                Size: <b className="status-ok">{formatBytes(response.bodySize + response.headersSize)}</b>
            </span>
            <Dropdown
                className="save-response"
                label={<>Save Response <Icon name="chevron-down" /></>}
                items={[
                    { label: 'Save response body…', icon: 'save', onClick: () => post({ type: 'saveResponse', index, bodyOnly: true }) },
                    { label: 'Save full response…', icon: 'save-all', onClick: () => post({ type: 'saveResponse', index, bodyOnly: false }) },
                    { label: 'Copy response body', icon: 'copy', onClick: () => post({ type: 'copyText', text: response.body }) },
                ]}
            />
        </div>
    );
}

function timingTitle(response: ResponseModel) {
    const t = response.timings;
    return [['Socket', t.wait], ['DNS', t.dns], ['TCP', t.tcp], ['TLS', t.tls], ['First byte', t.firstByte], ['Download', t.download]]
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}: ${Math.round(v as number)} ms`)
        .join('\n');
}

function languageFor(contentType: string | undefined, body: string): EditorLanguage {
    const ct = contentType?.toLowerCase() ?? '';
    if (ct.includes('json') || (!ct && /^\s*[{[]/.test(body))) {
        return 'json';
    }
    if (ct.includes('html')) {
        return 'html';
    }
    if (ct.includes('xml')) {
        return 'xml';
    }
    if (ct.includes('javascript')) {
        return 'javascript';
    }
    return 'text';
}

function ResponseBody({ response }: { response: ResponseModel }) {
    const isHtml = /html/i.test(response.contentType ?? '');
    const isImage = !!response.base64Body;
    const [view, setView] = useState<BodyView>(isImage ? 'preview' : 'pretty');
    const [wrap, setWrap] = useState(true);
    const language = languageFor(response.contentType, response.body);
    const effectiveView = !isHtml && !isImage && view === 'preview' ? 'pretty' : view;

    return (
        <div className="response-body">
            <div className="body-toolbar">
                <div className="segmented">
                    {(['pretty', 'raw', 'preview'] as BodyView[]).map(v => (
                        <button
                            key={v}
                            type="button"
                            className={effectiveView === v ? 'active' : ''}
                            disabled={v === 'preview' && !isHtml && !isImage}
                            onClick={() => setView(v)}>
                            {v[0].toUpperCase() + v.substring(1)}
                        </button>
                    ))}
                </div>
                <span className="body-language">{language.toUpperCase()}</span>
                <div className="spacer" />
                <IconButton icon="word-wrap" title="Toggle word wrap" className={wrap ? 'toggled' : ''} onClick={() => setWrap(!wrap)} />
                <IconButton icon="copy" title="Copy body" onClick={() => post({ type: 'copyText', text: response.body })} />
            </div>
            {response.truncated && (
                <div className="hint warning">
                    The body is larger than <code>rest-client.largeResponseBodySizeLimitInMB</code> and was truncated. Save it to see everything.
                </div>
            )}
            {effectiveView === 'preview' && isImage && (
                <div className="image-preview"><img src={`data:${response.contentType};base64,${response.base64Body}`} alt="Response" /></div>
            )}
            {effectiveView === 'preview' && isHtml && (
                <iframe className="html-preview" sandbox="" srcDoc={response.body} title="HTML preview" />
            )}
            {effectiveView !== 'preview' && (
                <CodeEditor
                    className="fill"
                    readOnly
                    wrap={wrap}
                    language={effectiveView === 'pretty' ? language : 'text'}
                    value={effectiveView === 'pretty' ? (response.prettyBody ?? response.body) : response.body}
                />
            )}
        </div>
    );
}

function HeaderTable({ rows }: { rows: [string, string][] }) {
    return (
        <table className="data-table">
            <thead><tr><th>KEY</th><th>VALUE</th></tr></thead>
            <tbody>
                {rows.map(([k, v], i) => <tr key={i}><td className="key-cell">{k}</td><td className="value-cell">{v}</td></tr>)}
            </tbody>
        </table>
    );
}

interface ParsedCookie {
    name: string;
    value: string;
    attributes: Record<string, string>;
}

function parseSetCookies(response: ResponseModel): ParsedCookie[] {
    return response.headers
        .filter(([k]) => k.toLowerCase() === 'set-cookie')
        .map(([, v]) => {
            const [pair, ...attrs] = v.split(';');
            const eq = pair.indexOf('=');
            const attributes: Record<string, string> = {};
            for (const attr of attrs) {
                const [ak, ...av] = attr.trim().split('=');
                attributes[ak.toLowerCase()] = av.join('=') || 'true';
            }
            return { name: pair.substring(0, eq).trim(), value: pair.substring(eq + 1).trim(), attributes };
        });
}

function CookieTable({ cookies }: { cookies: ParsedCookie[] }) {
    if (cookies.length === 0) {
        return <EmptyState icon="globe" title="No cookies were set by this response" />;
    }
    return (
        <table className="data-table">
            <thead><tr><th>NAME</th><th>VALUE</th><th>DOMAIN</th><th>PATH</th><th>EXPIRES</th><th>HTTPONLY</th><th>SECURE</th></tr></thead>
            <tbody>
                {cookies.map((c, i) => (
                    <tr key={i}>
                        <td className="key-cell">{c.name}</td>
                        <td className="value-cell">{c.value}</td>
                        <td>{c.attributes.domain ?? ''}</td>
                        <td>{c.attributes.path ?? ''}</td>
                        <td>{c.attributes.expires ?? (c.attributes['max-age'] ? `max-age ${c.attributes['max-age']}` : 'Session')}</td>
                        <td>{c.attributes.httponly ? 'true' : 'false'}</td>
                        <td>{c.attributes.secure ? 'true' : 'false'}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

function Timeline({ response }: { response: ResponseModel }) {
    const t = response.timings;
    const phases = useMemo(() => ([
        ['Socket wait', t.wait],
        ['DNS lookup', t.dns],
        ['TCP handshake', t.tcp],
        ['TLS handshake', t.tls],
        ['Request sent', t.request],
        ['Waiting (TTFB)', t.firstByte],
        ['Content download', t.download],
    ] as [string, number | undefined][]).filter(([, v]) => v !== undefined) as [string, number][], [t]);
    const total = t.total ?? phases.reduce((a, [, v]) => a + v, 0);
    let offset = 0;

    return (
        <div className="timeline">
            <div className="timeline-phases">
                {phases.map(([label, value]) => {
                    const left = total ? (offset / total) * 100 : 0;
                    const width = total ? Math.max((value / total) * 100, 0.5) : 0;
                    offset += value;
                    return (
                        <div key={label} className="phase">
                            <span className="phase-label">{label}</span>
                            <div className="phase-track"><div className="phase-bar" style={{ left: `${left}%`, width: `${width}%` }} /></div>
                            <span className="phase-value">{value.toFixed(1)} ms</span>
                        </div>
                    );
                })}
                <div className="phase total">
                    <span className="phase-label">Total</span>
                    <div className="phase-track" />
                    <span className="phase-value">{total.toFixed(1)} ms</span>
                </div>
            </div>
            <div className="section-label">REQUEST SENT</div>
            <pre className="raw-exchange">
                {`${response.request.method} ${response.request.url}\n`}
                {response.request.headers.map(([k, v]) => `${k}: ${v}\n`).join('')}
                {response.request.body ? `\n${response.request.body}` : ''}
            </pre>
            <div className="section-label">RESPONSE RECEIVED</div>
            <pre className="raw-exchange">
                {`HTTP/${response.httpVersion} ${response.statusCode} ${response.statusMessage}\n`}
                {response.headers.map(([k, v]) => `${k}: ${v}\n`).join('')}
            </pre>
            <div className="hint">Received at {new Date(response.receivedAt).toLocaleTimeString()}</div>
        </div>
    );
}
