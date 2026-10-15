// Types shared between the extension host and the webview.

export interface KeyValue {
    key: string;
    value: string;
    enabled: boolean;
    /** A comment line inside the header block that isn't a header; kept so it survives a round trip. */
    rawLine?: string;
}

export interface PromptDefinition {
    name: string;
    description?: string;
}

export interface RequestMetadataModel {
    /** `# @name foo`: makes the request a named request variable. */
    name?: string;
    /** `# @note [text]`: asks for confirmation before sending. `''` means present without text. */
    note?: string;
    noRedirect: boolean;
    noCookieJar: boolean;
    prompts: PromptDefinition[];
}

export interface HttpRequestModel {
    /** Text after the `###` delimiter that precedes the request. */
    title?: string;
    metadata: RequestMetadataModel;
    /** Set when the request is written as a curl command; method/url/headers/body are unused then. */
    curl?: string;
    method: string;
    /** Request URL including enabled query params. */
    url: string;
    /** Query params written as commented-out continuation lines (`# &key=value`). */
    disabledParams: KeyValue[];
    httpVersion?: string;
    headers: KeyValue[];
    /** Raw body text with `\n` line endings. */
    body: string;
}

export interface ParsedRequest extends HttpRequestModel {
    index: number;
    /** 0-based line numbers in the document. */
    delimiterLine?: number;
    startLine: number;
    endLine: number;
}

export interface FileVariable {
    key: string;
    value: string;
    /** Line in the document; undefined for a variable the UI just added. */
    line?: number;
}

export interface ParsedHttpFile {
    requests: ParsedRequest[];
    fileVariables: FileVariable[];
    eol: '\n' | '\r\n';
}

export type VariableSource = 'file' | 'environment' | 'request' | 'system' | 'prompt';

export interface VariableInfo {
    name: string;
    value?: string;
    source: VariableSource;
    /** For named requests: whether a response is cached. */
    sent?: boolean;
}

export interface EnvironmentInfo {
    names: string[];
    current: string | null;
    /** Raw `rest-client.environmentVariables` value, including `$shared`. */
    variables: Record<string, Record<string, string>>;
}

export interface TimingPhases {
    wait?: number;
    dns?: number;
    tcp?: number;
    tls?: number;
    request?: number;
    firstByte?: number;
    download?: number;
    total?: number;
}

export interface ResponseModel {
    statusCode: number;
    statusMessage: string;
    httpVersion: string;
    headers: [string, string][];
    contentType?: string;
    body: string;
    prettyBody?: string;
    /** Base64 body for images. */
    base64Body?: string;
    bodySize: number;
    headersSize: number;
    truncated: boolean;
    timings: TimingPhases;
    durationMs: number;
    request: {
        method: string;
        url: string;
        headers: [string, string][];
        body?: string;
    };
    receivedAt: number;
}

export interface HistoryEntry {
    id: string;
    time: number;
    method: string;
    url: string;
    statusCode?: number;
    durationMs?: number;
    error?: string;
    fileUri?: string;
    fileName?: string;
    title?: string;
    /** Request as written in the file, before variables are resolved. */
    requestText: string;
}

export interface CookieInfo {
    key: string;
    value: string;
    domain: string;
    path: string;
    expires?: string;
    httpOnly: boolean;
    secure: boolean;
}

export interface CodegenTarget {
    key: string;
    title: string;
    clients: { key: string; title: string }[];
}

export interface StudioConfig {
    responsePane: 'bottom' | 'right';
}

// ---- Messages ----

export type HostToWebview =
    | { type: 'init'; fileName: string; file: ParsedHttpFile; env: EnvironmentInfo; variables: VariableInfo[]; codegenTargets: CodegenTarget[]; config: StudioConfig; selectIndex?: number }
    | { type: 'documentChanged'; file: ParsedHttpFile; source: 'self' | 'external' }
    | { type: 'variables'; variables: VariableInfo[] }
    | { type: 'env'; env: EnvironmentInfo }
    | { type: 'config'; config: StudioConfig }
    | { type: 'requestStarted'; index: number }
    | { type: 'requestFinished'; index: number; response: ResponseModel }
    | { type: 'requestFailed'; index: number; error: string; cancelled?: boolean }
    | { type: 'history'; entries: HistoryEntry[] }
    | { type: 'cookies'; cookies: CookieInfo[] }
    | { type: 'codeSnippet'; target: string; client: string; code: string; error?: string }
    | { type: 'filePicked'; requestId: string; path?: string }
    | { type: 'select'; index: number };

export type WebviewToHost =
    | { type: 'ready' }
    | { type: 'updateRequest'; index: number; request: HttpRequestModel }
    | { type: 'addRequest'; request?: HttpRequestModel; afterIndex?: number }
    | { type: 'duplicateRequest'; index: number }
    | { type: 'deleteRequest'; index: number }
    | { type: 'moveRequest'; from: number; to: number }
    | { type: 'updateFileVariables'; variables: FileVariable[] }
    | { type: 'send'; index: number }
    | { type: 'cancel'; index: number }
    | { type: 'selectEnv'; name: string | null }
    | { type: 'saveEnvironments'; variables: Record<string, Record<string, string>> }
    | { type: 'save' }
    | { type: 'openAsText'; line?: number }
    | { type: 'generateCode'; index: number; target: string; client: string }
    | { type: 'copyAsCurl'; index: number }
    | { type: 'copyText'; text: string }
    | { type: 'saveResponse'; index: number; bodyOnly: boolean }
    | { type: 'getHistory' }
    | { type: 'clearHistory' }
    | { type: 'openHistory'; id: string; mode: 'open' | 'insert' }
    | { type: 'getCookies' }
    | { type: 'deleteCookie'; cookie: CookieInfo }
    | { type: 'clearCookies' }
    | { type: 'pickFile'; requestId: string }
    | { type: 'showError'; message: string };
