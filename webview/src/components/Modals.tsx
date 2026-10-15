import { useEffect, useState } from 'react';
import { KeyValue } from '../../../src/shared/types';
import { requestCode, setModal, useStudio } from '../store';
import { post } from '../vscode';
import { CodeEditor, EditorLanguage } from './CodeEditor';
import { EmptyState, IconButton, Modal } from './common';
import { KeyValueTable } from './KeyValueTable';

export function Modals() {
    const modal = useStudio(s => s.modal);
    switch (modal) {
        case 'code': return <CodeModal />;
        case 'cookies': return <CookieModal />;
        case 'env': return <EnvironmentModal />;
        default: return null;
    }
}

const close = () => setModal(null);

const snippetLanguages: Record<string, EditorLanguage> = {
    javascript: 'javascript',
    node: 'javascript',
    xml: 'xml',
};

function CodeModal() {
    const targets = useStudio(s => s.codegenTargets);
    const snippet = useStudio(s => s.codeSnippet);
    const [target, setTarget] = useState(snippet?.target ?? 'shell');
    const targetInfo = targets.find(t => t.key === target) ?? targets[0];
    const [client, setClient] = useState(snippet?.client ?? 'curl');
    const clientKey = targetInfo?.clients.some(c => c.key === client) ? client : targetInfo?.clients[0]?.key;

    useEffect(() => {
        if (targetInfo && clientKey) {
            requestCode(targetInfo.key, clientKey);
        }
    }, [targetInfo?.key, clientKey]);

    return (
        <Modal title="Generate code snippet" onClose={close} wide>
            <div className="codegen-controls">
                <select value={targetInfo?.key} onChange={e => setTarget(e.target.value)}>
                    {targets.map(t => <option key={t.key} value={t.key}>{t.title}</option>)}
                </select>
                <select value={clientKey} onChange={e => setClient(e.target.value)}>
                    {targetInfo?.clients.map(c => <option key={c.key} value={c.key}>{c.title}</option>)}
                </select>
                <div className="spacer" />
                <button
                    type="button"
                    className="secondary-button"
                    disabled={!snippet?.code}
                    onClick={() => snippet?.code && post({ type: 'copyText', text: snippet.code })}>
                    Copy to clipboard
                </button>
            </div>
            {snippet?.loading && <div className="hint">Generating…</div>}
            {snippet?.error && <div className="hint warning">{snippet.error}</div>}
            {snippet?.code !== undefined && !snippet.loading && !snippet.error && (
                <CodeEditor className="codegen-output" readOnly value={snippet.code} language={snippetLanguages[targetInfo?.key ?? ''] ?? 'text'} />
            )}
            <div className="hint">Variables are resolved with the current environment.</div>
        </Modal>
    );
}

function CookieModal() {
    const cookies = useStudio(s => s.cookies);
    useEffect(() => post({ type: 'getCookies' }), []);
    const domains = [...new Set(cookies.map(c => c.domain))].sort();

    return (
        <Modal
            title="Cookies"
            onClose={close}
            wide
            footer={
                <>
                    <span className="hint">Shared with REST Client (<code>~/.rest-client/cookie.json</code>)</span>
                    <div className="spacer" />
                    <button type="button" className="secondary-button" disabled={cookies.length === 0} onClick={() => post({ type: 'clearCookies' })}>Clear all</button>
                </>
            }>
            {cookies.length === 0 && <EmptyState icon="globe" title="The cookie jar is empty" />}
            {domains.map(domain => (
                <div key={domain} className="cookie-domain">
                    <div className="section-label">{domain}</div>
                    <table className="data-table compact">
                        <thead><tr><th>NAME</th><th>VALUE</th><th>PATH</th><th>EXPIRES</th><th /></tr></thead>
                        <tbody>
                            {cookies.filter(c => c.domain === domain).map(c => (
                                <tr key={`${c.path}|${c.key}`}>
                                    <td className="key-cell">{c.key}</td>
                                    <td className="value-cell">{c.value}</td>
                                    <td>{c.path}</td>
                                    <td>{c.expires ? new Date(c.expires).toLocaleString() : 'Session'}</td>
                                    <td className="kv-actions">
                                        <IconButton icon="trash" title="Delete cookie" onClick={() => post({ type: 'deleteCookie', cookie: c })} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            ))}
        </Modal>
    );
}

const SHARED = '$shared';

function EnvironmentModal() {
    const env = useStudio(s => s.env);
    const [variables, setVariables] = useState<Record<string, Record<string, string>>>(() => structuredClone(env.variables));
    const names = [SHARED, ...Object.keys(variables).filter(n => n !== SHARED)];
    const [active, setActive] = useState(env.current && names.includes(env.current) ? env.current : SHARED);
    const [newName, setNewName] = useState('');
    const dirty = JSON.stringify(variables) !== JSON.stringify(env.variables);

    const rows: KeyValue[] = Object.entries(variables[active] ?? {}).map(([key, value]) => ({ key, value: String(value), enabled: true }));
    const setRows = (next: KeyValue[]) => {
        const values: Record<string, string> = {};
        for (const row of next) {
            values[row.key] = row.value;
        }
        setVariables({ ...variables, [active]: values });
    };

    const addEnvironment = () => {
        const name = newName.trim();
        if (!name || variables[name]) {
            return;
        }
        setVariables({ ...variables, [name]: {} });
        setActive(name);
        setNewName('');
    };

    const removeEnvironment = (name: string) => {
        const next = { ...variables };
        delete next[name];
        setVariables(next);
        setActive(SHARED);
    };

    return (
        <Modal
            title="Manage environments"
            onClose={close}
            wide
            footer={
                <>
                    <span className="hint">Stored in the <code>rest-client.environmentVariables</code> setting.</span>
                    <div className="spacer" />
                    <button type="button" className="secondary-button" onClick={close}>Cancel</button>
                    <button
                        type="button"
                        className="primary-button"
                        disabled={!dirty}
                        onClick={() => {
                            const cleaned: Record<string, Record<string, string>> = {};
                            for (const [name, values] of Object.entries(variables)) {
                                cleaned[name] = Object.fromEntries(Object.entries(values).filter(([k]) => k.trim() !== ''));
                            }
                            if (cleaned[SHARED] && Object.keys(cleaned[SHARED]).length === 0 && !env.variables[SHARED]) {
                                delete cleaned[SHARED];
                            }
                            post({ type: 'saveEnvironments', variables: cleaned });
                            close();
                        }}>
                        Save
                    </button>
                </>
            }>
            <div className="env-editor">
                <div className="env-list">
                    {names.map(name => (
                        <div key={name} className={`env-item ${name === active ? 'selected' : ''}`} onClick={() => setActive(name)}>
                            <span>{name === SHARED ? '$shared (all)' : name}</span>
                            {name !== SHARED && (
                                <IconButton icon="trash" title="Delete environment" onClick={e => { e.stopPropagation(); removeEnvironment(name); }} />
                            )}
                        </div>
                    ))}
                    <div className="env-add">
                        <input value={newName} placeholder="New environment" onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addEnvironment()} />
                        <IconButton icon="add" title="Add environment" onClick={addEnvironment} />
                    </div>
                </div>
                <div className="env-variables">
                    <KeyValueTable rows={rows} toggleable={false} keyPlaceholder="Variable" onChange={setRows} />
                    <div className="hint">
                        Reference shared values with <code>{'{{$shared name}}'}</code>, and values from the same environment with <code>{`{{$${active === SHARED ? 'shared' : active} name}}`}</code>.
                    </div>
                </div>
            </div>
        </Modal>
    );
}
