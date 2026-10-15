import { useEffect, useRef, useState } from 'react';
import { Icon, IconButton, EmptyState } from './components/common';
import { Modals } from './components/Modals';
import { RequestEditor } from './components/RequestEditor';
import { ResponsePane } from './components/ResponsePane';
import { Sidebar } from './components/Sidebar';
import { addRequest, flushDraft, send, setModal, setSidebarTab, useStudio } from './store';
import { getPersisted, persist, post } from './vscode';

export function App() {
    const ready = useStudio(s => s.ready);
    const hasDraft = useStudio(s => !!s.draft);
    const responsePane = useStudio(s => s.config.responsePane);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const mod = e.metaKey || e.ctrlKey;
            if (mod && e.key === 'Enter') {
                e.preventDefault();
                send();
            } else if (mod && e.key.toLowerCase() === 's') {
                e.preventDefault();
                flushDraft();
                post({ type: 'save' });
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    if (!ready) {
        return <div className="loading-screen"><div className="spinner" /></div>;
    }

    return (
        <div className="app">
            <TopBar />
            <div className="main">
                <ResizableSidebar />
                <main className="workspace">
                    {hasDraft ? (
                        <Split direction={responsePane === 'right' ? 'horizontal' : 'vertical'}
                            first={<RequestEditor />}
                            second={<ResponsePane />} />
                    ) : (
                        <EmptyState icon="file-code" title="This file has no requests yet">
                            <button type="button" className="primary-button" onClick={() => addRequest()}>New request</button>
                        </EmptyState>
                    )}
                </main>
            </div>
            <Modals />
        </div>
    );
}

function TopBar() {
    const fileName = useStudio(s => s.fileName);
    const env = useStudio(s => s.env);
    return (
        <header className="top-bar">
            <div className="file-name"><Icon name="file-code" /> {fileName}</div>
            <div className="spacer" />
            <div className="env-picker">
                <select
                    value={env.current ?? ''}
                    title="Environment (shared with REST Client)"
                    onChange={e => post({ type: 'selectEnv', name: e.target.value || null })}>
                    <option value="">No Environment</option>
                    {env.names.map(n => <option key={n} value={n}>{n}</option>)}
                    {env.current && !env.names.includes(env.current) ? <option value={env.current}>{env.current} (missing)</option> : null}
                </select>
                <IconButton icon="eye" title="Show variables" onClick={() => setSidebarTab('variables')} />
                <IconButton icon="settings-gear" title="Manage environments" onClick={() => setModal('env')} />
            </div>
            <div className="top-actions">
                <IconButton icon="go-to-file" title="Open as text" onClick={() => post({ type: 'openAsText' })} />
                <button type="button" className="secondary-button" title="Save (Ctrl/Cmd+S)" onClick={() => { flushDraft(); post({ type: 'save' }); }}>
                    <Icon name="save" /> Save
                </button>
            </div>
        </header>
    );
}

function ResizableSidebar() {
    const [width, setWidth] = useState(getPersisted().sidebarWidth ?? 260);
    const onPointerDown = (e: React.PointerEvent) => {
        const startX = e.clientX;
        const startWidth = width;
        const move = (ev: PointerEvent) => setWidth(Math.min(600, Math.max(160, startWidth + ev.clientX - startX)));
        const up = (ev: PointerEvent) => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            persist({ sidebarWidth: Math.min(600, Math.max(160, startWidth + ev.clientX - startX)) });
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    };
    return (
        <>
            <div style={{ width, flex: `0 0 ${width}px` }} className="sidebar-container"><Sidebar /></div>
            <div className="splitter splitter-vertical" onPointerDown={onPointerDown} />
        </>
    );
}

function Split({ direction, first, second }: { direction: 'vertical' | 'horizontal'; first: React.ReactNode; second: React.ReactNode }) {
    const [ratio, setRatio] = useState(getPersisted().split ?? 0.5);
    const container = useRef<HTMLDivElement>(null);
    const vertical = direction === 'vertical';

    const onPointerDown = (e: React.PointerEvent) => {
        e.preventDefault();
        const rect = container.current!.getBoundingClientRect();
        const compute = (ev: PointerEvent) => {
            const r = vertical ? (ev.clientY - rect.top) / rect.height : (ev.clientX - rect.left) / rect.width;
            return Math.min(0.85, Math.max(0.15, r));
        };
        const move = (ev: PointerEvent) => setRatio(compute(ev));
        const up = (ev: PointerEvent) => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
            persist({ split: compute(ev) });
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    };

    return (
        <div className={`split split-${direction}`} ref={container}>
            <div className="split-pane" style={{ flexBasis: `${ratio * 100}%` }}>{first}</div>
            <div className={`splitter ${vertical ? 'splitter-horizontal' : 'splitter-vertical'}`} onPointerDown={onPointerDown} />
            <div className="split-pane" style={{ flexBasis: `${(1 - ratio) * 100}%` }}>{second}</div>
        </div>
    );
}
