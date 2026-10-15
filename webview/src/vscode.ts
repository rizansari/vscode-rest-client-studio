import { WebviewToHost } from '../../src/shared/types';

interface VsCodeApi {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const api: VsCodeApi = typeof acquireVsCodeApi === 'function'
    ? acquireVsCodeApi()
    : { postMessage: m => console.log('postMessage', m), getState: () => undefined, setState: () => undefined };

export function post(message: WebviewToHost) {
    api.postMessage(message);
}

export interface PersistedState {
    selected?: number;
    requestTab?: string;
    sidebarTab?: string;
    split?: number;
    sidebarWidth?: number;
}

export function getPersisted(): PersistedState {
    return (api.getState() as PersistedState | undefined) ?? {};
}

export function persist(patch: PersistedState) {
    api.setState({ ...getPersisted(), ...patch });
}
