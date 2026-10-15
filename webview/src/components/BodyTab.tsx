import { useEffect, useState } from 'react';
import {
    BodyMode, buildFileReference, buildFormBody, buildMultipartBody, defaultBoundary, detectBodyMode, detectRawLanguage,
    getBoundary, getHeaderValue, joinGraphQl, MultipartRow, parseFileReference, parseFormBody, parseMultipartBody,
    rawContentTypes, RawLanguage, setHeader, splitGraphQl
} from '../../../src/shared/requestUtil';
import { HttpRequestModel, KeyValue } from '../../../src/shared/types';
import { editDraft } from '../store';
import { post } from '../vscode';
import { CodeEditor } from './CodeEditor';
import { IconButton, VariableInput } from './common';
import { KeyValueTable } from './KeyValueTable';

const modes: { id: BodyMode; label: string }[] = [
    { id: 'none', label: 'none' },
    { id: 'form-urlencoded', label: 'x-www-form-urlencoded' },
    { id: 'multipart', label: 'form-data' },
    { id: 'raw', label: 'raw' },
    { id: 'graphql', label: 'GraphQL' },
    { id: 'file', label: 'file' },
];

const rawLanguages: { id: RawLanguage; label: string }[] = [
    { id: 'json', label: 'JSON' },
    { id: 'xml', label: 'XML' },
    { id: 'html', label: 'HTML' },
    { id: 'javascript', label: 'JavaScript' },
    { id: 'text', label: 'Text' },
];

const isStructuredType = (contentType: string | undefined) =>
    !!contentType && /x-www-form-urlencoded|multipart\/form-data/i.test(contentType);

export function BodyTab({ draft, selected }: { draft: HttpRequestModel; selected: number }) {
    // The mode is derived from headers and body; a just-picked mode wins until the content catches up
    // (e.g. "file" with no path yet).
    const [override, setOverride] = useState<BodyMode | undefined>();
    useEffect(() => setOverride(undefined), [selected]);
    const detected = detectBodyMode(draft);
    const mode = override ?? detected;
    useEffect(() => {
        if (override === detected) {
            setOverride(undefined);
        }
    }, [override, detected]);

    const changeMode = (next: BodyMode) => {
        setOverride(next);
        editDraft(d => switchMode(d, next));
    };

    return (
        <div className="panel-section body-tab">
            <div className="body-modes">
                {modes.map(m => (
                    <label key={m.id} className="radio">
                        <input type="radio" name="body-mode" checked={mode === m.id} onChange={() => changeMode(m.id)} />
                        {m.label}
                    </label>
                ))}
                {mode === 'raw' && <RawLanguagePicker draft={draft} />}
                {mode === 'raw' && detectRawLanguage(draft) === 'json' && <BeautifyButton draft={draft} />}
            </div>
            {mode === 'none' && <div className="hint centered">This request does not have a body</div>}
            {mode === 'raw' && (
                <CodeEditor
                    className="fill"
                    language={detectRawLanguage(draft)}
                    value={draft.body}
                    onChange={body => editDraft(d => ({ ...d, body }))}
                />
            )}
            {mode === 'form-urlencoded' && <FormEditor draft={draft} />}
            {mode === 'multipart' && <MultipartEditor draft={draft} />}
            {mode === 'graphql' && <GraphQlEditor draft={draft} />}
            {mode === 'file' && <FileEditor draft={draft} />}
        </div>
    );
}

function switchMode(d: HttpRequestModel, mode: BodyMode): HttpRequestModel {
    // lowercase: current REST Client releases only recognize `graphql`
    let headers = setHeader(d.headers, 'X-Request-Type', mode === 'graphql' ? 'graphql' : undefined);
    const contentType = getHeaderValue(headers, 'Content-Type');
    let body = d.body;
    switch (mode) {
        case 'none':
            body = '';
            break;
        case 'raw':
            if (!contentType || isStructuredType(contentType)) {
                headers = setHeader(headers, 'Content-Type', rawContentTypes.json);
            }
            break;
        case 'form-urlencoded':
            headers = setHeader(headers, 'Content-Type', 'application/x-www-form-urlencoded');
            body = isStructuredType(contentType) ? '' : body.includes('=') && !body.includes('\n{') ? body : '';
            break;
        case 'multipart':
            headers = setHeader(headers, 'Content-Type', `multipart/form-data; boundary=${defaultBoundary}`);
            body = buildMultipartBody([], defaultBoundary);
            break;
        case 'graphql':
            headers = setHeader(headers, 'Content-Type', 'application/json');
            body = body && !isStructuredType(contentType) ? body : 'query {\n  \n}';
            break;
        case 'file':
            body = '';
            if (isStructuredType(contentType)) {
                headers = setHeader(headers, 'Content-Type', 'application/octet-stream');
            }
            break;
    }
    return { ...d, headers, body };
}

function RawLanguagePicker({ draft }: { draft: HttpRequestModel }) {
    const language = detectRawLanguage(draft);
    return (
        <select
            className="raw-language"
            value={language}
            onChange={e => editDraft(d => ({ ...d, headers: setHeader(d.headers, 'Content-Type', rawContentTypes[e.target.value as RawLanguage]) }))}>
            {rawLanguages.map(l => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
    );
}

function BeautifyButton({ draft }: { draft: HttpRequestModel }) {
    return (
        <button
            type="button"
            className="link-button beautify"
            onClick={() => {
                try {
                    // keep unquoted {{variables}} parseable while formatting
                    const placeholders: string[] = [];
                    const masked = draft.body.replace(/\{\{.+?\}\}/g, m => {
                        placeholders.push(m);
                        return `"__studio_var_${placeholders.length - 1}__"`;
                    });
                    const pretty = JSON.stringify(JSON.parse(masked), null, 2)
                        .replace(/"__studio_var_(\d+)__"/g, (_, i) => placeholders[Number(i)]);
                    editDraft(d => ({ ...d, body: pretty }));
                } catch (e) {
                    post({ type: 'showError', message: `Can't beautify: the body is not valid JSON (${(e as Error).message})` });
                }
            }}>
            Beautify
        </button>
    );
}

function FormEditor({ draft }: { draft: HttpRequestModel }) {
    return (
        <>
            <KeyValueTable
                rows={parseFormBody(draft.body)}
                bulkEdit
                onChange={rows => editDraft(d => ({ ...d, body: buildFormBody(rows) }))}
            />
            <div className="hint">Encoding follows the <code>rest-client.formParamEncodingStrategy</code> setting.</div>
        </>
    );
}

type MultipartTableRow = KeyValue & { type: 'text' | 'file'; contentType?: string };

function MultipartEditor({ draft }: { draft: HttpRequestModel }) {
    const boundary = getBoundary(draft.headers) ?? defaultBoundary;
    const parsed = parseMultipartBody(draft.body, boundary);
    if (!parsed) {
        return (
            <>
                <div className="hint warning">
                    The body couldn't be read as form-data with boundary <code>{boundary}</code>; edit it as text.
                </div>
                <CodeEditor className="fill" value={draft.body} onChange={body => editDraft(d => ({ ...d, body }))} />
            </>
        );
    }
    const rows: MultipartTableRow[] = parsed.map(p => ({ key: p.key, value: p.value, type: p.type, contentType: p.contentType, enabled: true }));
    const apply = (next: MultipartTableRow[]) => editDraft(d => ({
        ...d,
        headers: getBoundary(d.headers) ? d.headers : setHeader(d.headers, 'Content-Type', `multipart/form-data; boundary=${boundary}`),
        body: buildMultipartBody(next.map((r): MultipartRow => ({ key: r.key, value: r.value, type: r.type, contentType: r.contentType })), boundary),
    }));

    return (
        <>
            <table className="kv-table multipart">
                <thead>
                    <tr><th>KEY</th><th className="mp-type">TYPE</th><th>VALUE</th><th className="kv-actions" /></tr>
                </thead>
                <tbody>
                    {[...rows, { key: '', value: '', type: 'text', enabled: true } as MultipartTableRow].map((row, i) => {
                        const isNew = i === rows.length;
                        const update = (patch: Partial<MultipartTableRow>) =>
                            apply(isNew ? [...rows, { ...row, ...patch }] : rows.map((r, j) => j === i ? { ...r, ...patch } : r));
                        return (
                            <tr key={i} className={isNew ? 'kv-new' : ''}>
                                <td><VariableInput value={row.key} placeholder="Key" onChange={key => update({ key })} /></td>
                                <td className="mp-type">
                                    <select value={row.type} onChange={e => update({ type: e.target.value as 'text' | 'file' })}>
                                        <option value="text">Text</option>
                                        <option value="file">File</option>
                                    </select>
                                </td>
                                <td>
                                    {row.type === 'file'
                                        ? <FilePathInput value={row.value} onChange={value => update({ value })} />
                                        : <VariableInput value={row.value} placeholder="Value" onChange={value => update({ value })} />}
                                </td>
                                <td className="kv-actions">
                                    {!isNew && <IconButton icon="trash" title="Delete" onClick={() => apply(rows.filter((_, j) => j !== i))} />}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
            <div className="hint">Files are referenced with <code>&lt; path</code>, relative to the .http file or the workspace.</div>
        </>
    );
}

function GraphQlEditor({ draft }: { draft: HttpRequestModel }) {
    const { query, variables } = splitGraphQl(draft.body);
    return (
        <div className="graphql">
            <div className="graphql-pane">
                <div className="section-label">QUERY</div>
                <CodeEditor className="fill" language="graphql" value={query} onChange={q => editDraft(d => ({ ...d, body: joinGraphQl(q, splitGraphQl(d.body).variables) }))} />
            </div>
            <div className="graphql-pane">
                <div className="section-label">GRAPHQL VARIABLES</div>
                <CodeEditor className="fill" language="json" value={variables} onChange={v => editDraft(d => ({ ...d, body: joinGraphQl(splitGraphQl(d.body).query, v) }))} />
            </div>
        </div>
    );
}

let pickCounter = 0;

function FilePathInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const [requestId] = useState(() => `pick-${pickCounter++}`);
    useEffect(() => {
        const listener = (e: Event) => {
            const detail = (e as CustomEvent).detail as { requestId: string; path?: string };
            if (detail.requestId === requestId && detail.path) {
                onChange(detail.path);
            }
        };
        window.addEventListener('studio:filePicked', listener);
        return () => window.removeEventListener('studio:filePicked', listener);
    }, [requestId, onChange]);
    return (
        <div className="file-input">
            <VariableInput value={value} placeholder="./path/to/file" onChange={onChange} />
            <button type="button" className="secondary-button" onClick={() => post({ type: 'pickFile', requestId })}>Select File…</button>
        </div>
    );
}

function FileEditor({ draft }: { draft: HttpRequestModel }) {
    const ref = parseFileReference(draft.body) ?? { path: '', processVariables: false };
    const apply = (path: string, processVariables: boolean, encoding?: string) =>
        editDraft(d => ({ ...d, body: path.trim() ? buildFileReference(path.trim(), processVariables, encoding) : '' }));
    return (
        <div className="file-body">
            <div className="form-row">
                <span className="form-label">File</span>
                <FilePathInput value={ref.path} onChange={p => apply(p, ref.processVariables, ref.encoding)} />
            </div>
            <label className="form-check">
                <input type="checkbox" checked={ref.processVariables} onChange={e => apply(ref.path, e.target.checked, ref.encoding)} />
                <span>Resolve <code>{'{{variables}}'}</code> inside the file (<code>&lt;@</code>)</span>
            </label>
            {ref.processVariables && (
                <label className="form-row">
                    <span className="form-label">Encoding</span>
                    <input value={ref.encoding ?? ''} placeholder="utf8" onChange={e => apply(ref.path, true, e.target.value || undefined)} />
                </label>
            )}
            <div className="hint">Set a matching <code>Content-Type</code> header. The path is relative to the .http file or the workspace root.</div>
        </div>
    );
}
