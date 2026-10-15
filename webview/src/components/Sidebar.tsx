import { useEffect, useRef, useState } from 'react';
import { requestDisplayName } from '../../../src/shared/requestUtil';
import { FileVariable, HistoryEntry, KeyValue } from '../../../src/shared/types';
import {
    addRequest, deleteRequest, duplicateRequest, moveRequest, select, setModal, setSidebarTab, SidebarTab, useStudio
} from '../store';
import { post } from '../vscode';
import { EmptyState, IconButton, MethodBadge, Tabs } from './common';
import { KeyValueTable } from './KeyValueTable';

export function Sidebar() {
    const tab = useStudio(s => s.sidebarTab);
    return (
        <aside className="sidebar">
            <Tabs<SidebarTab>
                className="sidebar-tabs"
                active={tab}
                onChange={setSidebarTab}
                tabs={[
                    { id: 'requests', label: 'Requests' },
                    { id: 'history', label: 'History' },
                    { id: 'variables', label: 'Variables' },
                ]}
            />
            <div className="sidebar-content">
                {tab === 'requests' && <RequestList />}
                {tab === 'history' && <HistoryList />}
                {tab === 'variables' && <VariablesPanel />}
            </div>
        </aside>
    );
}

function RequestList() {
    const requests = useStudio(s => s.file.requests);
    const selected = useStudio(s => s.selected);
    const draft = useStudio(s => s.draft);
    const responses = useStudio(s => s.responses);
    const [filter, setFilter] = useState('');
    const [dragIndex, setDragIndex] = useState<number>();
    const [dropIndex, setDropIndex] = useState<number>();

    const visible = requests
        .map((r, i) => ({ request: i === selected && draft ? { ...r, ...draft } : r, index: i }))
        .filter(({ request }) => !filter || `${request.method} ${request.url} ${request.title ?? ''} ${request.metadata.name ?? ''}`
            .toLowerCase().includes(filter.toLowerCase()));

    return (
        <div className="request-list">
            <div className="list-toolbar">
                <IconButton icon="add" title="New request" onClick={() => addRequest()} />
                <input className="filter-input" placeholder="Filter requests" value={filter} onChange={e => setFilter(e.target.value)} />
            </div>
            {requests.length === 0 && (
                <EmptyState icon="file" title="No requests in this file">
                    <button type="button" className="secondary-button" onClick={() => addRequest()}>Add a request</button>
                </EmptyState>
            )}
            <ul>
                {visible.map(({ request, index }) => (
                    <li
                        key={index}
                        className={`request-item ${index === selected ? 'selected' : ''} ${dropIndex === index && dragIndex !== index ? 'drop-target' : ''}`}
                        draggable={!filter}
                        onDragStart={e => { setDragIndex(index); e.dataTransfer.effectAllowed = 'move'; }}
                        onDragOver={e => { if (dragIndex !== undefined) { e.preventDefault(); setDropIndex(index); } }}
                        onDragLeave={() => setDropIndex(undefined)}
                        onDrop={e => {
                            e.preventDefault();
                            if (dragIndex !== undefined) {
                                moveRequest(dragIndex, index);
                            }
                            setDragIndex(undefined);
                            setDropIndex(undefined);
                        }}
                        onDragEnd={() => { setDragIndex(undefined); setDropIndex(undefined); }}
                        onClick={() => select(index)}
                        title={request.curl ?? `${request.method} ${request.url}`}>
                        {request.curl !== undefined ? <span className="method method-small method-curl">CURL</span> : <MethodBadge method={request.method} small />}
                        <div className="request-item-text">
                            <span className="request-item-name">{requestDisplayName(request)}</span>
                            {request.title || request.metadata.name ? <span className="request-item-url">{request.curl ?? request.url}</span> : null}
                        </div>
                        {responses[index]?.loading ? <span className="mini-spinner" /> : null}
                        <div className="request-item-actions" onClick={e => e.stopPropagation()}>
                            <IconButton icon="copy" title="Duplicate" onClick={() => duplicateRequest(index)} />
                            <IconButton icon="trash" title="Delete" onClick={() => deleteRequest(index)} />
                        </div>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function timeAgo(time: number) {
    const seconds = Math.round((Date.now() - time) / 1000);
    if (seconds < 60) {
        return 'just now';
    }
    if (seconds < 3600) {
        return `${Math.floor(seconds / 60)}m ago`;
    }
    if (seconds < 86400) {
        return `${Math.floor(seconds / 3600)}h ago`;
    }
    return new Date(time).toLocaleDateString();
}

function HistoryList() {
    const history = useStudio(s => s.history);
    const [filter, setFilter] = useState('');
    const visible = history.filter(e => !filter || `${e.method} ${e.url} ${e.title ?? ''}`.toLowerCase().includes(filter.toLowerCase()));

    return (
        <div className="history-list">
            <div className="list-toolbar">
                <input className="filter-input" placeholder="Filter history" value={filter} onChange={e => setFilter(e.target.value)} />
                <IconButton icon="clear-all" title="Clear history" disabled={history.length === 0} onClick={() => post({ type: 'clearHistory' })} />
            </div>
            {history.length === 0 && <EmptyState icon="history" title="Requests you send will appear here" />}
            <ul>
                {visible.map(entry => <HistoryItem key={entry.id} entry={entry} />)}
            </ul>
        </div>
    );
}

function HistoryItem({ entry }: { entry: HistoryEntry }) {
    const status = entry.error ? 'ERR' : entry.statusCode;
    return (
        <li className="history-item" title={`${entry.method} ${entry.url}\n${entry.fileName ?? ''}`} onClick={() => post({ type: 'openHistory', id: entry.id, mode: 'open' })}>
            <MethodBadge method={entry.method} small />
            <div className="request-item-text">
                <span className="request-item-name">{entry.url}</span>
                <span className="request-item-url">
                    <span className={entry.error ? 'status-error' : (entry.statusCode ?? 0) >= 400 ? 'status-warn' : 'status-ok'}>{status}</span>
                    {entry.durationMs !== undefined ? ` · ${entry.durationMs} ms` : ''} · {timeAgo(entry.time)}{entry.fileName ? ` · ${entry.fileName}` : ''}
                </span>
            </div>
            <div className="request-item-actions" onClick={e => e.stopPropagation()}>
                <IconButton icon="add" title="Add to this file" onClick={() => post({ type: 'openHistory', id: entry.id, mode: 'insert' })} />
            </div>
        </li>
    );
}

type FileVariableRow = KeyValue & { line?: number };

function VariablesPanel() {
    const fileVariables = useStudio(s => s.file.fileVariables);
    const variables = useStudio(s => s.variables);
    const env = useStudio(s => s.env);
    const [rows, setRows] = useState<FileVariableRow[]>([]);
    const timer = useRef<ReturnType<typeof setTimeout>>();
    const editing = useRef(false);

    // follow the document unless an edit is pending
    useEffect(() => {
        if (!editing.current) {
            setRows(fileVariables.map(v => ({ key: v.key, value: v.value, enabled: true, line: v.line })));
        }
    }, [fileVariables]);

    const onChange = (next: FileVariableRow[]) => {
        setRows(next);
        editing.current = true;
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
            editing.current = false;
            const payload: FileVariable[] = next.map(r => ({ key: r.key, value: r.value, line: r.line }));
            post({ type: 'updateFileVariables', variables: payload });
        }, 400);
    };

    const envVariables = variables.filter(v => v.source === 'environment');
    const requestVariables = variables.filter(v => v.source === 'request');
    const systemVariables = variables.filter(v => v.source === 'system');

    return (
        <div className="variables-panel">
            <section>
                <div className="section-label">FILE VARIABLES <code>@name = value</code></div>
                <KeyValueTable rows={rows} toggleable={false} keyPlaceholder="name" onChange={onChange} />
            </section>
            <section>
                <div className="section-label with-action">
                    <span>ENVIRONMENT {env.current ? <b>{env.current}</b> : <i>(no environment, $shared only)</i>}</span>
                    <button type="button" className="link-button" onClick={() => setModal('env')}>Manage</button>
                </div>
                {envVariables.length === 0
                    ? <div className="hint">No environment variables. Define them in <code>rest-client.environmentVariables</code>.</div>
                    : <ReadOnlyVariables rows={envVariables.map(v => [v.name, v.value ?? ''])} />}
            </section>
            <section>
                <div className="section-label">REQUEST VARIABLES <code># @name</code></div>
                {requestVariables.length === 0
                    ? <div className="hint">Name a request in its Settings tab to reuse its response, e.g. <code>{'{{login.response.body.$.token}}'}</code>.</div>
                    : <ReadOnlyVariables rows={requestVariables.map(v => [v.name, v.sent ? 'response available' : 'not sent yet'])} />}
            </section>
            <section>
                <div className="section-label">SYSTEM VARIABLES</div>
                <div className="chips">
                    {systemVariables.map(v => (
                        <button type="button" key={v.name} className="chip" title="Copy" onClick={() => post({ type: 'copyText', text: `{{${v.name}}}` })}>
                            {`{{${v.name}}}`}
                        </button>
                    ))}
                </div>
            </section>
        </div>
    );
}

function ReadOnlyVariables({ rows }: { rows: [string, string][] }) {
    return (
        <table className="data-table compact">
            <tbody>
                {rows.map(([k, v]) => (
                    <tr key={k} onClick={() => post({ type: 'copyText', text: `{{${k}}}` })} title="Click to copy the reference">
                        <td className="key-cell">{k}</td>
                        <td className="value-cell">{v}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}
