import { randomUUID } from 'crypto';
import { EOL } from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { HttpRequest } from '../core/httpRequest';
import { HttpResponse } from '../core/httpResponse';
import { MimeUtility } from '../core/mimeUtility';
import { RequestParserFactory } from '../core/requestParserFactory';
import { RequestVariableCache } from '../core/requestVariableCache';
import { ResponseFormatUtility } from '../core/responseFormatUtility';
import { Selector } from '../core/selector';
import { IRestClientSettings, loadSettings } from '../core/settings';
import { convertStreamToString } from '../core/streamUtility';
import { UnresolvedVariable, VariableProcessor } from '../core/variableProcessor';
import { displayName, getRequestBlockText, parseHttpFile } from '../model/httpFile';
import { HistoryEntry, ParsedRequest, ResponseModel } from '../../shared/types';
import { CookieService } from './cookieService';
import { HistoryService } from './historyService';

export class CancelledError extends Error {
    public constructor() {
        super('Request cancelled');
    }
}

export interface PreparedRequest {
    model: ParsedRequest;
    rawText: string;
    httpRequest: HttpRequest;
    settings: IRestClientSettings;
    unresolved: UnresolvedVariable[];
}

const passwordPromptNames = ['password', 'passwd', 'pass'];

export class RequestRunner {
    private readonly running = new Map<string, HttpRequest>();
    private readonly lastResponses = new Map<string, HttpResponse>();

    public constructor(private readonly cookies: CookieService, private readonly history: HistoryService) {
    }

    private static key(document: vscode.TextDocument, index: number) {
        return `${document.uri.toString()}#${index}`;
    }

    /** Resolves variables (asking for `@prompt` values) and parses request `index` the way REST Client does. */
    public async prepare(document: vscode.TextDocument, index: number): Promise<PreparedRequest> {
        const text = document.getText();
        const model = parseHttpFile(text).requests[index];
        const block = getRequestBlockText(text, index);
        if (!model || !block) {
            throw new Error(`Request #${index + 1} not found`);
        }

        const promptValues = new Map<string, string>();
        for (const { name, description } of model.metadata.prompts) {
            const value = await vscode.window.showInputBox({
                title: displayName(model),
                prompt: `Input value for "${name}"`,
                placeHolder: description,
                password: passwordPromptNames.includes(name.toLowerCase()),
                ignoreFocusOut: true,
            });
            if (value === undefined) {
                throw new CancelledError();
            }
            promptValues.set(name, value);
        }

        const rawText = Selector.getRequestText(block.text, EOL);
        if (!rawText) {
            throw new Error('The request is empty');
        }
        const unresolved: UnresolvedVariable[] = [];
        const resolvedText = await VariableProcessor.processRawRequest(rawText, document, promptValues, unresolved);
        const settings = loadSettings(document.uri, model.metadata);
        const httpRequest = await RequestParserFactory.createRequestParser(resolvedText, settings, document)
            .parseHttpRequest(model.metadata.name || undefined);
        return { model, rawText, httpRequest, settings, unresolved };
    }

    public async send(document: vscode.TextDocument, index: number): Promise<ResponseModel> {
        const key = RequestRunner.key(document, index);
        this.running.get(key)?.cancel();

        const prepared = await this.prepare(document, index);
        const { model, httpRequest, settings } = prepared;

        if (model.metadata.note !== undefined) {
            const answer = await vscode.window.showWarningMessage(
                `Are you sure you want to send the request "${displayName(model)}"?`,
                { modal: true, detail: model.metadata.note || undefined },
                'Send');
            if (answer !== 'Send') {
                throw new CancelledError();
            }
        }

        const entry: HistoryEntry = {
            id: randomUUID(),
            time: Date.now(),
            method: httpRequest.method,
            url: httpRequest.url,
            fileUri: document.uri.toString(),
            fileName: path.basename(document.fileName),
            title: displayName(model),
            requestText: prepared.rawText,
        };

        this.running.set(key, httpRequest);
        const start = Date.now();
        let response: HttpResponse;
        try {
            response = await this.cookies.httpClient.send(httpRequest, settings, document);
        } catch (e) {
            if (httpRequest.isCancelled) {
                throw new CancelledError();
            }
            const message = describeError(e);
            await this.history.add({ ...entry, error: message, durationMs: Date.now() - start });
            throw new Error(message);
        } finally {
            if (this.running.get(key) === httpRequest) {
                this.running.delete(key);
            }
        }
        const durationMs = Date.now() - start;

        if (model.metadata.name) {
            RequestVariableCache.add(document, model.metadata.name, response);
        }
        this.lastResponses.set(key, response);
        this.cookies.notifyChanged();
        await this.history.add({ ...entry, statusCode: response.statusCode, durationMs });

        return toResponseModel(response, settings, durationMs);
    }

    public cancel(document: vscode.TextDocument, index: number) {
        this.running.get(RequestRunner.key(document, index))?.cancel();
    }

    public getLastResponse(document: vscode.TextDocument, index: number): HttpResponse | undefined {
        return this.lastResponses.get(RequestRunner.key(document, index));
    }
}

function describeError(e: any): string {
    const code = e?.code ? `${e.code}: ` : '';
    return `${code}${e?.message ?? String(e)}`;
}

function headerPairs(headers: Record<string, unknown>): [string, string][] {
    const pairs: [string, string][] = [];
    for (const [name, value] of Object.entries(headers)) {
        if (value === undefined) {
            continue;
        }
        for (const v of Array.isArray(value) ? value : [value]) {
            pairs.push([name, String(v)]);
        }
    }
    return pairs;
}

async function toResponseModel(response: HttpResponse, settings: IRestClientSettings, durationMs: number): Promise<ResponseModel> {
    const contentType = response.contentType;
    const limit = settings.largeResponseBodySizeLimitInMB * 1024 * 1024;
    const truncated = response.body.length > limit;
    const body = truncated ? response.body.substring(0, limit) : response.body;

    let prettyBody: string | undefined;
    if (!truncated) {
        try {
            const formatted = ResponseFormatUtility.formatBody(body, contentType, true);
            prettyBody = formatted !== body ? formatted : undefined;
        } catch {
            prettyBody = undefined;
        }
    }

    const request = response.request;
    let requestBody: string | undefined;
    if (typeof request.body === 'string') {
        requestBody = request.body;
    } else if (request.body) {
        requestBody = request.rawBody ?? await convertStreamToString(request.body).catch(() => undefined);
    }

    const phases = response.timingPhases ?? {};
    return {
        statusCode: response.statusCode,
        statusMessage: response.statusMessage,
        httpVersion: response.httpVersion,
        headers: headerPairs(response.headers),
        contentType,
        body,
        prettyBody,
        base64Body: MimeUtility.isBrowserSupportedImageFormat(contentType) ? response.bodyBuffer.toString('base64') : undefined,
        bodySize: response.bodySizeInBytes,
        headersSize: response.headersSizeInBytes,
        truncated,
        timings: {
            wait: phases.wait, dns: phases.dns, tcp: phases.tcp, tls: phases.tls, request: phases.request,
            firstByte: phases.firstByte, download: phases.download, total: phases.total,
        },
        durationMs,
        request: {
            method: request.method,
            url: request.url,
            headers: headerPairs(request.headers),
            body: requestBody,
        },
        receivedAt: Date.now(),
    };
}
