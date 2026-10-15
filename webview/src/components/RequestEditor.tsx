import { useState } from 'react';
import { HttpMethods } from '../../../src/extension/core/constants';
import {
    AuthModel, AuthType, buildAuth, detectBodyMode, getHeaderValue, getParams, parseAuth, requestDisplayName, setHeader, setParams
} from '../../../src/shared/requestUtil';
import { HttpRequestModel, KeyValue, PromptDefinition } from '../../../src/shared/types';
import { cancel, editDraft, RequestTab, send, setModal, setRequestTab, useStudio } from '../store';
import { post } from '../vscode';
import { BodyTab } from './BodyTab';
import { CodeEditor } from './CodeEditor';
import { Dropdown, Icon, IconButton, Tabs, VariableInput } from './common';
import { commonHeaders, KeyValueTable } from './KeyValueTable';

export function RequestEditor() {
    const draft = useStudio(s => s.draft)!;
    const selected = useStudio(s => s.selected);
    const requestTab = useStudio(s => s.requestTab);
    const loading = useStudio(s => s.responses[s.selected]?.loading ?? false);

    if (draft.curl !== undefined) {
        return <CurlEditor draft={draft} selected={selected} loading={loading} />;
    }

    const params = getParams(draft);
    const visibleHeaders = draft.headers.filter(h => h.rawLine === undefined);
    const auth = getHeaderValue(draft.headers, 'Authorization');
    const bodyMode = detectBodyMode(draft);
    const metadataCount = (draft.metadata.name ? 1 : 0) + (draft.metadata.note !== undefined ? 1 : 0)
        + (draft.metadata.noRedirect ? 1 : 0) + (draft.metadata.noCookieJar ? 1 : 0) + draft.metadata.prompts.length;

    return (
        <div className="request-editor">
            <RequestTitle draft={draft} selected={selected} />
            <UrlBar draft={draft} loading={loading} />
            <Tabs<RequestTab>
                active={requestTab}
                onChange={setRequestTab}
                tabs={[
                    { id: 'params', label: 'Params', dot: params.some(p => p.enabled) },
                    { id: 'auth', label: 'Authorization', dot: auth !== undefined },
                    { id: 'headers', label: 'Headers', badge: visibleHeaders.length },
                    { id: 'body', label: 'Body', dot: bodyMode !== 'none' },
                    { id: 'settings', label: 'Settings', badge: metadataCount },
                ]}
                right={
                    <>
                        <button type="button" className="link-button" onClick={() => setModal('cookies')}>Cookies</button>
                        <button type="button" className="link-button" onClick={() => setModal('code')}>Code</button>
                    </>
                }
            />
            <div className="tab-panel">
                {requestTab === 'params' && <ParamsTab draft={draft} />}
                {requestTab === 'auth' && <AuthTab draft={draft} />}
                {requestTab === 'headers' && <HeadersTab draft={draft} />}
                {requestTab === 'body' && <BodyTab draft={draft} selected={selected} />}
                {requestTab === 'settings' && <SettingsTab draft={draft} />}
            </div>
        </div>
    );
}

function RequestTitle({ draft, selected }: { draft: HttpRequestModel; selected: number }) {
    const startLine = useStudio(s => s.file.requests[s.selected]?.startLine);
    return (
        <div className="request-title">
            <Icon name="chevron-right" className="muted" />
            <input
                className="title-input"
                value={draft.title ?? ''}
                placeholder={requestDisplayName({ ...draft, title: undefined })}
                spellCheck={false}
                title="Request title (the text after ###)"
                onChange={e => editDraft(d => ({ ...d, title: e.target.value }))}
            />
            <div className="request-title-actions">
                <IconButton icon="go-to-file" title="Show in text editor" onClick={() => post({ type: 'openAsText', line: startLine })} />
                <IconButton icon="copy" title="Copy as cURL" onClick={() => post({ type: 'copyAsCurl', index: selected })} />
            </div>
        </div>
    );
}

function UrlBar({ draft, loading }: { draft: HttpRequestModel; loading: boolean }) {
    const knownMethod = HttpMethods.includes(draft.method.toUpperCase());
    return (
        <div className="url-bar">
            <select
                className={`method-select method-text-${draft.method.toLowerCase()}`}
                value={knownMethod ? draft.method.toUpperCase() : 'GET'}
                onChange={e => editDraft(d => ({ ...d, method: e.target.value }))}>
                {HttpMethods.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <VariableInput
                className="url-input"
                value={draft.url}
                placeholder="Enter request URL"
                onChange={url => editDraft(d => ({ ...d, url }))}
                onKeyDown={e => {
                    if (e.key === 'Enter') {
                        send();
                    }
                }}
            />
            <SendButton loading={loading} />
        </div>
    );
}

function SendButton({ loading }: { loading: boolean }) {
    const selected = useStudio(s => s.selected);
    if (loading) {
        return (
            <div className="send-group">
                <button type="button" className="send-button cancel" onClick={() => cancel()}>Cancel</button>
            </div>
        );
    }
    return (
        <div className="send-group">
            <button type="button" className="send-button" title="Send (Ctrl/Cmd+Enter)" onClick={() => send()}>Send</button>
            <Dropdown
                className="send-more"
                icon="chevron-down"
                title="More"
                items={[
                    { label: 'Copy as cURL', icon: 'copy', onClick: () => post({ type: 'copyAsCurl', index: selected }) },
                    { label: 'Generate code…', icon: 'code', onClick: () => setModal('code') },
                    { label: 'Show in text editor', icon: 'go-to-file', onClick: () => post({ type: 'openAsText', line: useStudio.getState().file.requests[selected]?.startLine }) },
                ]}
            />
        </div>
    );
}

function CurlEditor({ draft, selected, loading }: { draft: HttpRequestModel; selected: number; loading: boolean }) {
    return (
        <div className="request-editor">
            <RequestTitle draft={draft} selected={selected} />
            <div className="url-bar">
                <span className="curl-label"><Icon name="terminal" /> cURL request</span>
                <div className="spacer" />
                <SendButton loading={loading} />
            </div>
            <div className="hint">This request is written as a curl command. REST Client parses it when sent.</div>
            <div className="tab-panel">
                <CodeEditor className="fill" value={draft.curl ?? ''} wrap onChange={curl => editDraft(d => ({ ...d, curl }))} />
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- params

function ParamsTab({ draft }: { draft: HttpRequestModel }) {
    return (
        <div className="panel-section">
            <div className="section-label">Query Params</div>
            <KeyValueTable
                rows={getParams(draft)}
                bulkEdit
                onChange={rows => editDraft(d => setParams(d, rows))}
            />
            <div className="hint">Disabled params are kept in the file as commented-out lines (<code># &amp;key=value</code>).</div>
        </div>
    );
}

// ---------------------------------------------------------------- headers

/** Replaces the visible (non-raw) header rows, keeping raw comment lines at their positions. */
function mergeHeaders(all: KeyValue[], visible: KeyValue[]): KeyValue[] {
    const result: KeyValue[] = [];
    let v = 0;
    for (const header of all) {
        if (header.rawLine !== undefined) {
            result.push(header);
        } else if (v < visible.length) {
            result.push(visible[v++]);
        }
    }
    result.push(...visible.slice(v));
    return result;
}

function HeadersTab({ draft }: { draft: HttpRequestModel }) {
    return (
        <div className="panel-section">
            <div className="section-label">Headers</div>
            <KeyValueTable
                rows={draft.headers.filter(h => h.rawLine === undefined)}
                keySuggestions={commonHeaders}
                bulkEdit
                onChange={rows => editDraft(d => ({ ...d, headers: mergeHeaders(d.headers, rows) }))}
            />
            <div className="hint">
                REST Client also adds the <code>rest-client.defaultHeaders</code> setting (User-Agent by default). Disabled headers are kept as <code># Header: value</code>.
            </div>
        </div>
    );
}

// ---------------------------------------------------------------- auth

const authTypes: { id: AuthType; label: string }[] = [
    { id: 'none', label: 'No Auth' },
    { id: 'basic', label: 'Basic Auth' },
    { id: 'digest', label: 'Digest Auth' },
    { id: 'bearer', label: 'Bearer Token' },
    { id: 'aws', label: 'AWS Signature v4' },
    { id: 'custom', label: 'Custom header value' },
];

function AuthTab({ draft }: { draft: HttpRequestModel }) {
    const auth = parseAuth(getHeaderValue(draft.headers, 'Authorization'));
    const apply = (next: AuthModel) => editDraft(d => ({ ...d, headers: setHeader(d.headers, 'Authorization', buildAuth(next)) }));
    const field = (key: keyof AuthModel, label: string, placeholder?: string, password?: boolean) => (
        <label className="form-row" key={key}>
            <span className="form-label">{label}</span>
            {password ? (
                <PasswordField value={(auth[key] as string) ?? ''} placeholder={placeholder} onChange={value => apply({ ...auth, [key]: value })} />
            ) : (
                <VariableInput value={(auth[key] as string) ?? ''} placeholder={placeholder} onChange={value => apply({ ...auth, [key]: value })} />
            )}
        </label>
    );

    return (
        <div className="panel-section auth">
            <div className="auth-type">
                <span className="form-label">Type</span>
                <select
                    value={auth.type}
                    onChange={e => {
                        const type = e.target.value as AuthType;
                        apply(type === 'custom' ? { type, raw: getHeaderValue(draft.headers, 'Authorization') ?? '' } : { ...auth, type });
                    }}>
                    {authTypes.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
            </div>
            <div className="auth-fields">
                {auth.type === 'none' && <div className="hint">This request does not use any authorization.</div>}
                {(auth.type === 'basic' || auth.type === 'digest') && <>
                    {field('username', 'Username')}
                    {field('password', 'Password', undefined, true)}
                </>}
                {auth.type === 'bearer' && field('token', 'Token', '{{token}}')}
                {auth.type === 'aws' && <>
                    {field('accessKeyId', 'Access Key')}
                    {field('secretAccessKey', 'Secret Key', undefined, true)}
                    {field('sessionToken', 'Session Token', 'optional', true)}
                    {field('region', 'AWS Region', 'e.g. us-east-1')}
                    {field('service', 'Service Name', 'e.g. execute-api')}
                </>}
                {auth.type === 'custom' && field('raw', 'Authorization', 'Scheme credentials')}
                {auth.type !== 'none' && (
                    <div className="hint">
                        Saved as the <code>Authorization</code> header using REST Client syntax:
                        <code className="block">Authorization: {buildAuth(auth)}</code>
                        Tip: use <code>{'{{variables}}'}</code> to keep secrets out of the file.
                    </div>
                )}
            </div>
        </div>
    );
}

function PasswordField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
    const [visible, setVisible] = useState(false);
    const hasVariable = /\{\{.+?\}\}/.test(value);
    return (
        <div className="password-field">
            {visible || hasVariable
                ? <VariableInput value={value} placeholder={placeholder} onChange={onChange} />
                : <input type="password" value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} />}
            {!hasVariable && <IconButton icon={visible ? 'eye-closed' : 'eye'} title={visible ? 'Hide' : 'Show'} onClick={() => setVisible(!visible)} />}
        </div>
    );
}

// ---------------------------------------------------------------- settings / metadata

function SettingsTab({ draft }: { draft: HttpRequestModel }) {
    const { metadata } = draft;
    const setMetadata = (patch: Partial<HttpRequestModel['metadata']>) =>
        editDraft(d => ({ ...d, metadata: { ...d.metadata, ...patch } }));
    const nameValid = !metadata.name || /^\w+$/.test(metadata.name);
    const prompts: (PromptDefinition & KeyValue)[] = metadata.prompts.map(p => ({ ...p, key: p.name, value: p.description ?? '', enabled: true }));

    return (
        <div className="panel-section settings">
            <label className="form-row">
                <span className="form-label">Request name <code>@name</code></span>
                <input
                    value={metadata.name ?? ''}
                    placeholder="e.g. login"
                    className={nameValid ? '' : 'invalid'}
                    onChange={e => setMetadata({ name: e.target.value || undefined })}
                />
            </label>
            <div className="hint">
                {nameValid
                    ? <>Named requests can be referenced from other requests, e.g. <code>{`{{${metadata.name || 'login'}.response.body.$.token}}`}</code></>
                    : <span className="error-text">Names may only contain letters, digits and underscores.</span>}
            </div>

            <label className="form-check">
                <input type="checkbox" checked={metadata.note !== undefined} onChange={e => setMetadata({ note: e.target.checked ? '' : undefined })} />
                <span>Ask for confirmation before sending <code>@note</code></span>
            </label>
            {metadata.note !== undefined && (
                <input className="indented" value={metadata.note} placeholder="Optional note shown in the confirmation" onChange={e => setMetadata({ note: e.target.value })} />
            )}

            <label className="form-check">
                <input type="checkbox" checked={metadata.noRedirect} onChange={e => setMetadata({ noRedirect: e.target.checked })} />
                <span>Don't follow redirects <code>@no-redirect</code></span>
            </label>
            <label className="form-check">
                <input type="checkbox" checked={metadata.noCookieJar} onChange={e => setMetadata({ noCookieJar: e.target.checked })} />
                <span>Don't use the cookie jar <code>@no-cookie-jar</code></span>
            </label>

            <div className="section-label">Prompt variables <code>@prompt</code></div>
            <KeyValueTable
                rows={prompts}
                toggleable={false}
                keyPlaceholder="Variable name"
                valuePlaceholder="Description (optional)"
                newRow={() => ({ name: '', key: '', value: '', enabled: true })}
                onChange={rows => setMetadata({ prompts: rows.map(r => ({ name: r.key, description: r.value || undefined })) })}
            />
            <div className="hint">You'll be asked for these values each time the request is sent; use them as <code>{'{{name}}'}</code>.</div>
        </div>
    );
}
