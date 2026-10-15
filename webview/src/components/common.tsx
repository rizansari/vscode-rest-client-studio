import { ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { VariableInfo } from '../../../src/shared/types';
import { useStudio } from '../store';

export function Icon({ name, className }: { name: string; className?: string }) {
    return <i className={`codicon codicon-${name} ${className ?? ''}`} />;
}

export function IconButton({ icon, title, onClick, disabled, className }: {
    icon: string; title: string; onClick: (e: React.MouseEvent) => void; disabled?: boolean; className?: string;
}) {
    return (
        <button type="button" className={`icon-button ${className ?? ''}`} title={title} aria-label={title} onClick={onClick} disabled={disabled}>
            <Icon name={icon} />
        </button>
    );
}

export function MethodBadge({ method, small }: { method: string; small?: boolean }) {
    const m = (method || 'GET').toUpperCase();
    return <span className={`method method-${m.toLowerCase()} ${small ? 'method-small' : ''}`}>{m === 'DELETE' && small ? 'DEL' : m}</span>;
}

export interface TabItem<T extends string> {
    id: T;
    label: ReactNode;
    badge?: number | string;
    dot?: boolean;
}

export function Tabs<T extends string>({ tabs, active, onChange, right, className }: {
    tabs: TabItem<T>[]; active: T; onChange: (id: T) => void; right?: ReactNode; className?: string;
}) {
    return (
        <div className={`tabs ${className ?? ''}`} role="tablist">
            {tabs.map(tab => (
                <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={tab.id === active}
                    className={`tab ${tab.id === active ? 'active' : ''}`}
                    onClick={() => onChange(tab.id)}>
                    {tab.label}
                    {tab.dot ? <span className="tab-dot" /> : null}
                    {tab.badge !== undefined && tab.badge !== 0 ? <span className="tab-badge">({tab.badge})</span> : null}
                </button>
            ))}
            {right ? <div className="tabs-right">{right}</div> : null}
        </div>
    );
}

export function Modal({ title, onClose, children, footer, wide }: {
    title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    return (
        <div className="modal-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
            <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-label={title}>
                <div className="modal-header">
                    <span>{title}</span>
                    <IconButton icon="close" title="Close" onClick={onClose} />
                </div>
                <div className="modal-body">{children}</div>
                {footer ? <div className="modal-footer">{footer}</div> : null}
            </div>
        </div>
    );
}

export function Dropdown({ label, icon, items, className, title }: {
    label?: ReactNode; icon?: string; title?: string; className?: string;
    items: { label: string; icon?: string; onClick: () => void; disabled?: boolean }[];
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) {
            return;
        }
        const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
        window.addEventListener('mousedown', close);
        return () => window.removeEventListener('mousedown', close);
    }, [open]);
    return (
        <div className={`dropdown ${className ?? ''}`} ref={ref}>
            <button type="button" className="dropdown-toggle" title={title} aria-label={title} onClick={() => setOpen(!open)}>
                {icon ? <Icon name={icon} /> : null}{label}
            </button>
            {open ? (
                <div className="dropdown-menu">
                    {items.map(item => (
                        <button key={item.label} type="button" disabled={item.disabled} onClick={() => { setOpen(false); item.onClick(); }}>
                            {item.icon ? <Icon name={item.icon} /> : <span className="dropdown-icon-space" />}
                            {item.label}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

// ---------------------------------------------------------------- variable-aware input

export function useVariableLookup() {
    const variables = useStudio(s => s.variables);
    return useMemo(() => {
        const map = new Map<string, VariableInfo>();
        // later sources don't override earlier ones: request > file > environment, like REST Client
        for (const source of ['system', 'request', 'file', 'environment'] as const) {
            for (const v of variables.filter(x => x.source === source)) {
                if (!map.has(v.name)) {
                    map.set(v.name, v);
                }
            }
        }
        return (reference: string): VariableInfo | undefined => {
            const name = reference.trim();
            if (name.startsWith('$')) {
                return map.get(name.split(/\s+/)[0]);
            }
            const plain = name.replace(/^%/, '');
            return map.get(plain) ?? map.get(plain.split('.')[0]);
        };
    }, [variables]);
}

function describeVariable(reference: string, info: VariableInfo | undefined): string {
    if (!info) {
        return `{{${reference}}}: not defined in the current environment or file`;
    }
    switch (info.source) {
        case 'system': return `{{${reference}}}: system variable, resolved when sent`;
        case 'request': return `{{${reference}}}: ${info.sent ? 'from the last response of' : 'send first:'} request "${info.name}"`;
        default: return `{{${reference}}} = ${info.value ?? ''}  (${info.source})`;
    }
}

/** Single-line input that highlights {{variables}} with a colored overlay behind transparent text. */
export function VariableInput({ value, onChange, placeholder, className, onKeyDown, autoFocus, list }: {
    value: string; onChange: (value: string) => void; placeholder?: string; className?: string;
    onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void; autoFocus?: boolean; list?: string;
}) {
    const lookup = useVariableLookup();
    const input = useRef<HTMLInputElement>(null);
    const overlay = useRef<HTMLDivElement>(null);
    const syncScroll = () => {
        if (overlay.current && input.current) {
            overlay.current.scrollLeft = input.current.scrollLeft;
        }
    };
    useLayoutEffect(syncScroll, [value]);

    const parts: ReactNode[] = [];
    const titles: string[] = [];
    let last = 0;
    const regex = /\{\{(.+?)\}\}/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(value))) {
        parts.push(value.substring(last, m.index));
        const info = lookup(m[1]);
        titles.push(describeVariable(m[1].trim(), info));
        parts.push(<span key={m.index} className={info ? 'var-ok' : 'var-missing'}>{m[0]}</span>);
        last = m.index + m[0].length;
    }
    parts.push(value.substring(last));

    return (
        <div className={`variable-input ${className ?? ''}`} title={titles.join('\n') || undefined}>
            <div className="variable-input-overlay" ref={overlay} aria-hidden="true">{parts}{'​'}</div>
            <input
                ref={input}
                value={value}
                placeholder={placeholder}
                spellCheck={false}
                autoFocus={autoFocus}
                list={list}
                onChange={e => onChange(e.target.value)}
                onScroll={syncScroll}
                onKeyDown={onKeyDown}
                onKeyUp={syncScroll}
                onClick={syncScroll}
            />
        </div>
    );
}

export function EmptyState({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
    return (
        <div className="empty-state">
            <Icon name={icon} className="empty-icon" />
            <div className="empty-title">{title}</div>
            {children ? <div className="empty-body">{children}</div> : null}
        </div>
    );
}
