import { create } from 'zustand';
import {
    CodegenTarget, CookieInfo, EnvironmentInfo, HistoryEntry, HostToWebview, HttpRequestModel, ParsedHttpFile,
    ResponseModel, StudioConfig, VariableInfo
} from '../../src/shared/types';
import { getPersisted, persist, post } from './vscode';

export interface ResponseState {
    loading: boolean;
    response?: ResponseModel;
    error?: string;
}

export type RequestTab = 'params' | 'auth' | 'headers' | 'body' | 'settings';
export type SidebarTab = 'requests' | 'history' | 'variables';
export type Modal = null | 'code' | 'cookies' | 'env';

export interface CodeSnippetState {
    target: string;
    client: string;
    code?: string;
    error?: string;
    loading: boolean;
}

interface State {
    ready: boolean;
    fileName: string;
    file: ParsedHttpFile;
    env: EnvironmentInfo;
    variables: VariableInfo[];
    codegenTargets: CodegenTarget[];
    config: StudioConfig;
    selected: number;
    /** Editing copy of the selected request; edits are written to the file after a short delay. */
    draft?: HttpRequestModel;
    responses: Record<number, ResponseState>;
    history: HistoryEntry[];
    cookies: CookieInfo[];
    modal: Modal;
    codeSnippet?: CodeSnippetState;
    requestTab: RequestTab;
    sidebarTab: SidebarTab;
}

const persisted = getPersisted();

export const useStudio = create<State>(() => ({
    ready: false,
    fileName: '',
    file: { requests: [], fileVariables: [], eol: '\n' },
    env: { names: [], current: null, variables: {} },
    variables: [],
    codegenTargets: [],
    config: { responsePane: 'bottom' },
    selected: persisted.selected ?? 0,
    responses: {},
    history: [],
    cookies: [],
    modal: null,
    requestTab: (persisted.requestTab as RequestTab) ?? 'params',
    sidebarTab: (persisted.sidebarTab as SidebarTab) ?? 'requests',
}));

const set = useStudio.setState;
const get = useStudio.getState;

// ---------------------------------------------------------------- draft syncing

const updateDelayMs = 300;
let updateTimer: ReturnType<typeof setTimeout> | undefined;
/** Set by structural edits (add/delete/move): the next document change reloads the draft. */
let resyncDraft = false;

export function flushDraft() {
    if (updateTimer === undefined) {
        return;
    }
    clearTimeout(updateTimer);
    updateTimer = undefined;
    const { draft, selected } = get();
    if (draft) {
        post({ type: 'updateRequest', index: selected, request: draft });
    }
}

export function editDraft(update: (draft: HttpRequestModel) => HttpRequestModel) {
    const { draft } = get();
    if (!draft) {
        return;
    }
    set({ draft: update(draft) });
    clearTimeout(updateTimer);
    updateTimer = setTimeout(flushDraft, updateDelayMs);
}

function draftFor(file: ParsedHttpFile, index: number): HttpRequestModel | undefined {
    const request = file.requests[index];
    if (!request) {
        return undefined;
    }
    // strip the position fields: the draft only carries what can be edited
    const { index: _i, delimiterLine: _d, startLine: _s, endLine: _e, ...model } = request;
    return model;
}

function clampIndex(file: ParsedHttpFile, index: number) {
    return Math.max(0, Math.min(index, file.requests.length - 1));
}

// ---------------------------------------------------------------- actions

export function select(index: number) {
    flushDraft();
    const { file } = get();
    const selected = clampIndex(file, index);
    set({ selected, draft: draftFor(file, selected) });
    persist({ selected });
}

export function setRequestTab(requestTab: RequestTab) {
    set({ requestTab });
    persist({ requestTab });
}

export function setSidebarTab(sidebarTab: SidebarTab) {
    set({ sidebarTab });
    persist({ sidebarTab });
}

export function setModal(modal: Modal) {
    set({ modal });
}

export function send(index = get().selected) {
    flushDraft();
    post({ type: 'send', index });
}

export function cancel(index = get().selected) {
    post({ type: 'cancel', index });
}

export function addRequest(afterIndex?: number) {
    flushDraft();
    resyncDraft = true;
    const { file } = get();
    const newIndex = afterIndex !== undefined ? afterIndex + 1 : file.requests.length;
    remapResponses(i => afterIndex !== undefined && i > afterIndex ? i + 1 : i);
    set({ selected: newIndex });
    persist({ selected: newIndex });
    post({ type: 'addRequest', afterIndex });
}

export function duplicateRequest(index: number) {
    flushDraft();
    resyncDraft = true;
    remapResponses(i => i > index ? i + 1 : i);
    set({ selected: index + 1 });
    persist({ selected: index + 1 });
    post({ type: 'duplicateRequest', index });
}

export function deleteRequest(index: number) {
    flushDraft();
    resyncDraft = true;
    const { selected } = get();
    remapResponses(i => i === index ? undefined : i > index ? i - 1 : i);
    const nextSelected = selected > index ? selected - 1 : selected === index ? Math.max(0, index - 1) : selected;
    set({ selected: nextSelected });
    persist({ selected: nextSelected });
    post({ type: 'deleteRequest', index });
}

export function moveRequest(from: number, to: number) {
    if (from === to) {
        return;
    }
    flushDraft();
    resyncDraft = true;
    const order = get().file.requests.map((_, i) => i);
    const [moved] = order.splice(from, 1);
    order.splice(to, 0, moved);
    remapResponses(i => order.indexOf(i));
    const { selected } = get();
    const nextSelected = order.indexOf(selected);
    set({ selected: nextSelected });
    persist({ selected: nextSelected });
    post({ type: 'moveRequest', from, to });
}

function remapResponses(map: (index: number) => number | undefined) {
    const next: Record<number, ResponseState> = {};
    for (const [key, value] of Object.entries(get().responses)) {
        const mapped = map(Number(key));
        if (mapped !== undefined && mapped >= 0) {
            next[mapped] = value;
        }
    }
    set({ responses: next });
}

export function requestCode(target: string, client: string) {
    flushDraft();
    set({ codeSnippet: { target, client, loading: true } });
    post({ type: 'generateCode', index: get().selected, target, client });
}

function setResponse(index: number, state: ResponseState) {
    set({ responses: { ...get().responses, [index]: state } });
}

// ---------------------------------------------------------------- host messages

export function handleHostMessage(message: HostToWebview) {
    switch (message.type) {
        case 'init': {
            const selected = clampIndex(message.file, message.selectIndex ?? get().selected);
            set({
                ready: true,
                fileName: message.fileName,
                file: message.file,
                env: message.env,
                variables: message.variables,
                codegenTargets: message.codegenTargets,
                config: message.config,
                selected,
                draft: draftFor(message.file, selected),
            });
            break;
        }
        case 'documentChanged': {
            const { draft, selected } = get();
            const nextSelected = clampIndex(message.file, selected);
            const reload = message.source === 'external' || resyncDraft || !draft || nextSelected !== selected;
            if (reload) {
                if (message.source === 'external') {
                    clearTimeout(updateTimer);
                    updateTimer = undefined;
                }
                resyncDraft = false;
                set({ file: message.file, selected: nextSelected, draft: draftFor(message.file, nextSelected) });
            } else {
                // our own edit: keep the draft, which may already hold newer keystrokes
                set({ file: message.file });
            }
            break;
        }
        case 'select':
            select(message.index);
            break;
        case 'variables':
            set({ variables: message.variables });
            break;
        case 'env':
            set({ env: message.env });
            break;
        case 'config':
            set({ config: message.config });
            break;
        case 'requestStarted':
            setResponse(message.index, { ...get().responses[message.index], loading: true, error: undefined });
            break;
        case 'requestFinished':
            setResponse(message.index, { loading: false, response: message.response });
            break;
        case 'requestFailed': {
            const previous = get().responses[message.index];
            setResponse(message.index, message.cancelled
                ? { loading: false, response: previous?.response }
                : { loading: false, error: message.error });
            break;
        }
        case 'history':
            set({ history: message.entries });
            break;
        case 'cookies':
            set({ cookies: message.cookies });
            break;
        case 'codeSnippet':
            set({ codeSnippet: { target: message.target, client: message.client, code: message.code, error: message.error, loading: false } });
            break;
        case 'filePicked':
            window.dispatchEvent(new CustomEvent('studio:filePicked', { detail: message }));
            break;
    }
}
