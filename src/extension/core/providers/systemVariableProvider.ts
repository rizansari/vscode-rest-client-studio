// Ported from vscode-restclient (MIT, Copyright (c) 2016-present Huachao Mao).
import dayjs, { Dayjs, ManipulateType } from 'dayjs';
import utc from 'dayjs/plugin/utc';
import * as dotenv from 'dotenv';
import * as fs from 'fs-extra';
import * as path from 'path';
import { Clipboard, env, TextDocument } from 'vscode';
import * as Constants from '../constants';
import { ResolveErrorMessage, ResolveWarningMessage } from '../httpVariableResolveResult';
import { VariableType } from '../variableType';
import { AadV2TokenProvider } from '../aadV2TokenProvider';
import { EnvironmentVariableProvider, getCurrentEnvironmentName } from './environmentVariableProvider';
import { HttpVariable, HttpVariableContext, HttpVariableProvider } from './httpVariableProvider';

import { randomUUID as uuidv4 } from 'crypto';

dayjs.extend(utc);

type SystemVariableValue = Pick<HttpVariable, Exclude<keyof HttpVariable, 'name'>>;
type ResolveSystemVariableFunc = (name: string, document: TextDocument, context: HttpVariableContext) => Promise<SystemVariableValue>;

export class SystemVariableProvider implements HttpVariableProvider {

    private readonly clipboard: Clipboard;
    private readonly resolveFuncs: Map<string, ResolveSystemVariableFunc> = new Map<string, ResolveSystemVariableFunc>();
    private readonly timestampRegex: RegExp = new RegExp(`\\${Constants.TimeStampVariableName}(?:\\s(\\-?\\d+)\\s(y|Q|M|w|d|h|m|s|ms))?`);
    private readonly datetimeRegex: RegExp = new RegExp(`\\${Constants.DateTimeVariableName}\\s(rfc1123|iso8601|\'.+\'|\".+\")(?:\\s(\\-?\\d+)\\s(y|Q|M|w|d|h|m|s|ms))?`);
    private readonly localDatetimeRegex: RegExp = new RegExp(`\\${Constants.LocalDateTimeVariableName}\\s(rfc1123|iso8601|\'.+\'|\".+\")(?:\\s(\\-?\\d+)\\s(y|Q|M|w|d|h|m|s|ms))?`);
    private readonly randomIntegerRegex: RegExp = new RegExp(`\\${Constants.RandomIntVariableName}\\s(\\-?\\d+)\\s(\\-?\\d+)`);
    private readonly processEnvRegex: RegExp = new RegExp(`\\${Constants.ProcessEnvVariableName}\\s(\\%)?(\\w+)`);

    private readonly dotenvRegex: RegExp = new RegExp(`\\${Constants.DotenvVariableName}\\s(\\%)?([\\w-.]+)`);


    private readonly innerSettingsEnvironmentVariableProvider: EnvironmentVariableProvider =  EnvironmentVariableProvider.Instance;
    private static _instance: SystemVariableProvider;

    public static get Instance(): SystemVariableProvider {
        if (!this._instance) {
            this._instance = new SystemVariableProvider();
        }

        return this._instance;
    }

    private constructor() {
        this.clipboard = env.clipboard;
        this.registerTimestampVariable();
        this.registerDateTimeVariable();
        this.registerLocalDateTimeVariable();
        this.registerGuidVariable();
        this.registerRandomIntVariable();
        this.registerProcessEnvVariable();
        this.registerDotenvVariable();
        this.registerAadTokenVariable();
        this.registerOidcTokenVariable();
        this.registerAadV2TokenVariable();
    }

    public readonly type: VariableType = VariableType.System;

    public async has(name: string, document: TextDocument): Promise<boolean> {
        const [variableName] = name.split(' ').filter(Boolean);
        return this.resolveFuncs.has(variableName);
    }

    public async get(name: string, document: TextDocument, context: HttpVariableContext): Promise<HttpVariable> {
        const [variableName] = name.split(' ').filter(Boolean);
        if (!this.resolveFuncs.has(variableName)) {
            return { name: variableName, error: ResolveErrorMessage.SystemVariableNotExist };
        }

        const result = await this.resolveFuncs.get(variableName)!(name, document, context);
        return { name: variableName, ...result };
    }

    public async getAll(document: undefined, context: HttpVariableContext): Promise<HttpVariable[]> {
        return [...this.resolveFuncs.keys()].map(name => ({ name }));
    }

    private registerTimestampVariable() {
        this.resolveFuncs.set(Constants.TimeStampVariableName, async name => {
            const groups = this.timestampRegex.exec(name);
            if (groups !== null && groups.length === 3) {
                const [, offset, option] = groups;
                const ts = offset && option
                    ? dayjs.utc().add(+offset, option as ManipulateType).unix()
                    : dayjs.utc().unix();
                return { value: ts.toString() };
            }

            return { warning: ResolveWarningMessage.IncorrectTimestampVariableFormat };
        });
    }

    private registerDateTimeVariable() {
        this.resolveFuncs.set(Constants.DateTimeVariableName, async name => {
            const groups = this.datetimeRegex.exec(name);
            if (groups !== null && groups.length === 4) {
                const [, type, offset, option] = groups;
                let date: Dayjs;
                if (offset && option) {
                    date = dayjs.utc().add(+offset, option as ManipulateType);
                } else {
                    date = dayjs.utc();
                }

                if (type === 'rfc1123') {
                    return { value: date.toDate().toUTCString() };
                } else if (type === 'iso8601') {
                    return { value: date.toISOString() };
                } else {
                    return { value: date.format(type.slice(1, type.length - 1)) };
                }
            }

            return { warning: ResolveWarningMessage.IncorrectDateTimeVariableFormat };
        });
    }

    private registerLocalDateTimeVariable() {
        this.resolveFuncs.set(Constants.LocalDateTimeVariableName, async name => {
            const groups = this.localDatetimeRegex.exec(name);
            if (groups !== null && groups.length === 4) {
                const [, type, offset, option] = groups;
                let date = dayjs.utc().local();
                if (offset && option) {
                    date = date.add(+offset, option as ManipulateType);
                }

                if (type === 'rfc1123') {
                    return { value: date.locale('en').format('ddd, DD MMM YYYY HH:mm:ss ZZ') };
                } else if (type === 'iso8601') {
                    return { value: date.format() };
                } else {
                    return { value: date.format(type.slice(1, type.length - 1)) };
                }
            }

            return { warning: ResolveWarningMessage.IncorrectLocalDateTimeVariableFormat };
        });
    }

    private registerGuidVariable() {
        this.resolveFuncs.set(Constants.GuidVariableName, async () => ({ value: uuidv4() }));
    }

    private registerRandomIntVariable() {
        this.resolveFuncs.set(Constants.RandomIntVariableName, async name => {
            const groups = this.randomIntegerRegex.exec(name);
            if (groups !== null && groups.length === 3) {
                const [, min, max] = groups;
                const minNum = Number(min);
                const maxNum = Number(max);
                if (minNum < maxNum) {
                    return { value: (Math.floor(Math.random() * (maxNum - minNum)) + minNum).toString() };
                }
            }

            return { warning: ResolveWarningMessage.IncorrectRandomIntegerVariableFormat };
        });
    }
    private registerProcessEnvVariable() {
        this.resolveFuncs.set(Constants.ProcessEnvVariableName, async (name, document) => {
            const groups = this.processEnvRegex.exec(name);
            if (groups !== null && groups.length === 3 ) {
                const [, refToggle, environmentVarName] = groups;
                let processEnvName = environmentVarName;
                if (refToggle !== undefined) {
                    processEnvName = await this.resolveSettingsEnvironmentVariable(environmentVarName, document);
                }
                const envValue = process.env[processEnvName];
                if (envValue !== undefined) {
                    return { value: envValue.toString() };
                } else {
                    return { value: '' };
                }
            }
            return { warning: ResolveWarningMessage.IncorrectProcessEnvVariableFormat };
        });
    }

    private registerDotenvVariable() {
        this.resolveFuncs.set(Constants.DotenvVariableName, async (name, document) => {
            let folderPath = path.dirname(document.fileName);
            const environmentName = await getCurrentEnvironmentName();

            let pathsFound = [false, false];

            while ((pathsFound = await Promise.all([
                fs.pathExists(path.join(folderPath, `.env.${environmentName}`)),
                fs.pathExists(path.join(folderPath, '.env'))
            ])).every(result => result === false)) {
                folderPath = path.join(folderPath, '..');
                if (folderPath === path.parse(process.cwd()).root) {
                    return { warning: ResolveWarningMessage.DotenvFileNotFound };
                }
            }
            const absolutePath = path.join(folderPath, pathsFound[0] ? `.env.${environmentName}` : '.env');
            const groups = this.dotenvRegex.exec(name);
            if (groups !== null && groups.length === 3) {
                const parsed = dotenv.parse(await fs.readFile(absolutePath));
                const [, refToggle, key] = groups;
                let dotEnvVarName = key;
                if (refToggle !== undefined) {
                    dotEnvVarName = await this.resolveSettingsEnvironmentVariable(key, document);
                }
                if (!(dotEnvVarName in parsed)) {
                    return { warning: ResolveWarningMessage.DotenvVariableNotFound };
                }

                return { value: parsed[dotEnvVarName] };
            }

            return { warning: ResolveWarningMessage.IncorrectDotenvVariableFormat };
        });
    }

    private registerAadTokenVariable() {
        this.resolveFuncs.set(Constants.AzureActiveDirectoryVariableName, async () =>
            ({ warning: '$aadToken (ADAL) is not supported by REST Client Studio; use $aadV2Token instead' }));
    }

    private registerOidcTokenVariable() {
        this.resolveFuncs.set(Constants.OidcVariableName, async () =>
            ({ warning: '$oidcAccessToken is not supported by REST Client Studio yet; send this request with REST Client' }));
    }

    private registerAadV2TokenVariable() {
        this.resolveFuncs.set(Constants.AzureActiveDirectoryV2TokenVariableName,
            async (name, document) => {
                const aadV2TokenProvider = new AadV2TokenProvider();
                const token = await aadV2TokenProvider.acquireToken(name, document);
                return {value: token};
            });
    }
    private async resolveSettingsEnvironmentVariable(name: string, document?: TextDocument) {
        if (await this.innerSettingsEnvironmentVariableProvider.has(name, document)) {
            const { value, error, warning } =  await this.innerSettingsEnvironmentVariableProvider.get(name, document);
            if (!error && !warning) {
                return value!.toString();
            } else {
                return name;
            }
        } else {
            return name;
        }
    }

}
