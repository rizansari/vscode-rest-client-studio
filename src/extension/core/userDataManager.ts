// Adapted from vscode-restclient (MIT, Copyright (c) 2016-present Huachao Mao).
// Uses the same folder as REST Client so that the current environment and cookies are shared.
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';

const restClientDir = 'rest-client';
const rootPath = process.env.VSC_REST_CLIENT_HOME !== undefined
    ? process.env.VSC_REST_CLIENT_HOME
    : path.join(os.homedir(), `.${restClientDir}`);

function getCachePath(): string {
    if (fs.existsSync(rootPath)) {
        return rootPath;
    }
    if (process.env.XDG_CACHE_HOME !== undefined) {
        return path.join(process.env.XDG_CACHE_HOME, restClientDir);
    }
    return rootPath;
}

function getStatePath(): string {
    if (fs.existsSync(rootPath)) {
        return rootPath;
    }
    if (process.env.XDG_STATE_HOME !== undefined) {
        return path.join(process.env.XDG_STATE_HOME, restClientDir);
    }
    return rootPath;
}

export interface StoredEnvironment {
    name: string;
    label: string;
    description?: string;
}

export class UserDataManager {
    private static readonly cachePath: string = getCachePath();
    private static readonly statePath: string = getStatePath();

    public static get cookieFilePath() {
        return path.join(this.cachePath, 'cookie.json');
    }

    public static get environmentFilePath() {
        return path.join(this.statePath, 'environment.json');
    }

    public static async initialize(): Promise<void> {
        await Promise.all([
            fs.ensureFile(this.cookieFilePath),
            fs.ensureFile(this.environmentFilePath),
        ]);
    }

    public static async getEnvironment(): Promise<StoredEnvironment | undefined> {
        try {
            return await fs.readJson(this.environmentFilePath);
        } catch {
            return undefined;
        }
    }

    public static async setEnvironment(item: StoredEnvironment): Promise<void> {
        await fs.ensureFile(this.environmentFilePath);
        await fs.writeJson(this.environmentFilePath, item);
    }
}
