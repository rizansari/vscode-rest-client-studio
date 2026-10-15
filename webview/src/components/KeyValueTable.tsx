import { useState } from 'react';
import { KeyValue } from '../../../src/shared/types';
import { IconButton, VariableInput } from './common';

interface Props<T extends KeyValue> {
    rows: T[];
    onChange: (rows: T[]) => void;
    keyPlaceholder?: string;
    valuePlaceholder?: string;
    /** Show the enable/disable checkbox column. */
    toggleable?: boolean;
    keySuggestions?: string[];
    bulkEdit?: boolean;
    newRow?: () => T;
}

let listCounter = 0;

/** key/value grid. The last, empty row adds a new entry as soon as it's typed into. */
export function KeyValueTable<T extends KeyValue>({
    rows, onChange, keyPlaceholder = 'Key', valuePlaceholder = 'Value', toggleable = true, keySuggestions, bulkEdit, newRow,
}: Props<T>) {
    const [bulk, setBulk] = useState(false);
    const [bulkText, setBulkText] = useState('');
    const [listId] = useState(() => `kv-suggestions-${listCounter++}`);
    const makeRow = newRow ?? (() => ({ key: '', value: '', enabled: true }) as T);

    const update = (index: number, patch: Partial<KeyValue>) => {
        if (index === rows.length) {
            onChange([...rows, { ...makeRow(), ...patch }]);
        } else {
            onChange(rows.map((r, i) => i === index ? { ...r, ...patch } : r));
        }
    };
    const remove = (index: number) => onChange(rows.filter((_, i) => i !== index));

    const toggleBulk = () => {
        if (!bulk) {
            setBulkText(rows.map(r => `${r.enabled ? '' : '//'}${r.key}:${r.value}`).join('\n'));
        } else {
            onChange(parseBulk(bulkText, rows, makeRow));
        }
        setBulk(!bulk);
    };

    const allEnabled = rows.length > 0 && rows.every(r => r.enabled);
    const display = [...rows, makeRow()];

    return (
        <div className="kv">
            {bulkEdit ? (
                <div className="kv-toolbar">
                    <button type="button" className="link-button" onClick={toggleBulk}>{bulk ? 'Key-Value Edit' : 'Bulk Edit'}</button>
                </div>
            ) : null}
            {bulk ? (
                <textarea
                    className="kv-bulk"
                    value={bulkText}
                    spellCheck={false}
                    placeholder={'Rows are separated by new lines\nKeys and values are separated by :\nPrepend // to any row you want to disable'}
                    onChange={e => {
                        setBulkText(e.target.value);
                        onChange(parseBulk(e.target.value, rows, makeRow));
                    }}
                />
            ) : (
                <table className="kv-table">
                    <thead>
                        <tr>
                            {toggleable ? (
                                <th className="kv-check">
                                    <input
                                        type="checkbox"
                                        checked={allEnabled}
                                        disabled={rows.length === 0}
                                        title={allEnabled ? 'Disable all' : 'Enable all'}
                                        onChange={() => onChange(rows.map(r => ({ ...r, enabled: !allEnabled })))}
                                    />
                                </th>
                            ) : null}
                            <th>KEY</th>
                            <th>VALUE</th>
                            <th className="kv-actions" />
                        </tr>
                    </thead>
                    <tbody>
                        {display.map((row, i) => {
                            const placeholderRow = i === rows.length;
                            return (
                                <tr key={i} className={`${row.enabled ? '' : 'kv-disabled'} ${placeholderRow ? 'kv-new' : ''}`}>
                                    {toggleable ? (
                                        <td className="kv-check">
                                            {placeholderRow ? null : (
                                                <input
                                                    type="checkbox"
                                                    checked={row.enabled}
                                                    title={row.enabled ? 'Disable' : 'Enable'}
                                                    onChange={e => update(i, { enabled: e.target.checked })}
                                                />
                                            )}
                                        </td>
                                    ) : null}
                                    <td>
                                        <VariableInput
                                            value={row.key}
                                            placeholder={keyPlaceholder}
                                            list={keySuggestions ? listId : undefined}
                                            onChange={key => update(i, { key })}
                                        />
                                    </td>
                                    <td>
                                        <VariableInput value={row.value} placeholder={valuePlaceholder} onChange={value => update(i, { value })} />
                                    </td>
                                    <td className="kv-actions">
                                        {placeholderRow ? null : <IconButton icon="trash" title="Delete" onClick={() => remove(i)} />}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            )}
            {keySuggestions ? (
                <datalist id={listId}>
                    {keySuggestions.map(s => <option key={s} value={s} />)}
                </datalist>
            ) : null}
        </div>
    );
}

function parseBulk<T extends KeyValue>(text: string, previous: T[], makeRow: () => T): T[] {
    return text.split('\n').filter(l => l.trim()).map((line, i) => {
        const disabled = line.trimStart().startsWith('//');
        const content = disabled ? line.trimStart().substring(2) : line;
        const separator = content.indexOf(':');
        const key = (separator === -1 ? content : content.substring(0, separator)).trim();
        const value = separator === -1 ? '' : content.substring(separator + 1).trim();
        return { ...(previous[i] ?? makeRow()), key, value, enabled: !disabled };
    });
}

export const commonHeaders = [
    'Accept', 'Accept-Charset', 'Accept-Encoding', 'Accept-Language', 'Authorization', 'Cache-Control', 'Connection',
    'Content-Disposition', 'Content-Encoding', 'Content-Length', 'Content-Type', 'Cookie', 'Date', 'Expect', 'Forwarded',
    'From', 'Host', 'If-Match', 'If-Modified-Since', 'If-None-Match', 'If-Range', 'If-Unmodified-Since', 'Origin',
    'Pragma', 'Prefer', 'Range', 'Referer', 'TE', 'Upgrade', 'User-Agent', 'Via', 'X-Api-Key', 'X-Correlation-ID',
    'X-Forwarded-For', 'X-Forwarded-Host', 'X-Forwarded-Proto', 'X-Request-ID', 'X-Request-Type',
];
