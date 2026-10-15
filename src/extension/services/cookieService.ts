import { Cookie, Store } from 'tough-cookie';
import * as vscode from 'vscode';
import { HttpClient } from '../core/httpClient';
import { CookieInfo } from '../../shared/types';

/**
 * Wraps the cookie jar file shared with REST Client (~/.rest-client/cookie.json).
 * One store instance is shared with the HTTP client so that edits are seen by both.
 */
export class CookieService implements vscode.Disposable {
    private readonly emitter = new vscode.EventEmitter<void>();
    public readonly onDidChange = this.emitter.event;
    public readonly httpClient: HttpClient;

    public constructor() {
        this.httpClient = new HttpClient(HttpClient.createCookieStore());
    }

    private get store(): Store {
        return this.httpClient.store;
    }

    public notifyChanged() {
        this.emitter.fire();
    }

    public list(): Promise<CookieInfo[]> {
        return new Promise((resolve, reject) => {
            this.store.getAllCookies((err, cookies) => {
                if (err) {
                    return reject(err);
                }
                resolve((cookies ?? []).map(toInfo));
            });
        });
    }

    public remove(cookie: CookieInfo): Promise<void> {
        return new Promise((resolve, reject) => {
            this.store.removeCookie(cookie.domain, cookie.path, cookie.key, err => {
                if (err) {
                    return reject(err);
                }
                this.emitter.fire();
                resolve();
            });
        });
    }

    public async clear(): Promise<void> {
        const cookies = await this.list();
        await new Promise<void>((resolve, reject) => {
            (this.store as any).removeAllCookies
                ? (this.store as any).removeAllCookies((err: Error | null) => err ? reject(err) : resolve())
                : Promise.all(cookies.map(c => this.remove(c))).then(() => resolve(), reject);
        });
        this.emitter.fire();
    }

    public dispose() {
        this.emitter.dispose();
    }
}

function toInfo(cookie: Cookie): CookieInfo {
    const expires = cookie.expires instanceof Date ? cookie.expires.toISOString() : undefined;
    return {
        key: cookie.key,
        value: cookie.value,
        domain: cookie.domain ?? '',
        path: cookie.path ?? '/',
        expires,
        httpOnly: !!cookie.httpOnly,
        secure: !!cookie.secure,
    };
}
