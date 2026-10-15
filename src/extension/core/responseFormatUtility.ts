// Ported from vscode-restclient (MIT, Copyright (c) 2016-present Huachao Mao).
import { createScanner, SyntaxKind } from 'jsonc-parser';
import * as os from 'os';
import { MimeUtility } from './mimeUtility';
import { isJSONString } from './misc';

export class ResponseFormatUtility {

    private static readonly jsonSpecialTokenMapping = {
        [SyntaxKind.OpenBraceToken]: '{',
        [SyntaxKind.CloseBraceToken]: '}',
        [SyntaxKind.OpenBracketToken]: '[',
        [SyntaxKind.CloseBracketToken]: ']',
        [SyntaxKind.ColonToken]: ':',
        [SyntaxKind.CommaToken]: ',',
        [SyntaxKind.NullKeyword]: 'null',
        [SyntaxKind.TrueKeyword]: 'true',
        [SyntaxKind.FalseKeyword]: 'false'
    };

    public static formatBody(body: string, contentType: string | undefined, suppressValidation: boolean, warn: (message: string) => void = () => {}): string {
        if (contentType) {
            if (MimeUtility.isJSON(contentType)) {
                if (isJSONString(body)) {
                    body = this.jsonPrettify(body);
                } else if (body && !suppressValidation) {
                    warn('The content type of response is application/json, while response body is not a valid json string');
                }
            } else if (MimeUtility.isXml(contentType)) {
                body = this.xmlPrettify(body);
            } else if (MimeUtility.isCSS(contentType)) {
                body = this.cssPrettify(body);
            } else {
                // Add this for the case that the content type of response body is not very accurate #239
                if (isJSONString(body)) {
                    body = this.jsonPrettify(body);
                }
            }
        }

        return body;
    }

    // Replaces pretty-data, whose sloppy-mode globals break in a strict-mode bundle.
    private static xmlPrettify(text: string, indent = '  '): string {
        const tokens = text.replace(/>\s*</g, '><').match(/<!\[CDATA\[[\s\S]*?\]\]>|<!--[\s\S]*?-->|<[^>]+>|[^<]+/g);
        if (!tokens) {
            return text;
        }
        let depth = 0;
        const lines: string[] = [];
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            if (/^<\//.test(token)) {
                depth = Math.max(depth - 1, 0);
                lines.push(indent.repeat(depth) + token);
            } else if (/^<[^!?][^>]*[^/]>$|^<[a-zA-Z]>$/.test(token)) {
                // keep <tag>text</tag> on one line
                const next = tokens[i + 1];
                const close = tokens[i + 2];
                if (next !== undefined && !next.startsWith('<') && close?.startsWith('</')) {
                    lines.push(indent.repeat(depth) + token + next.trim() + close);
                    i += 2;
                } else {
                    lines.push(indent.repeat(depth) + token);
                    depth++;
                }
            } else if (token.trim()) {
                lines.push(indent.repeat(depth) + token.trim());
            }
        }
        return lines.join(os.EOL);
    }

    private static cssPrettify(text: string, indent = '  '): string {
        let depth = 0;
        let result = '';
        for (const part of text.replace(/\s+/g, ' ').split(/([{};])/)) {
            if (part === '{') {
                result = result.trimEnd() + ' {' + os.EOL;
                depth++;
                result += indent.repeat(depth);
            } else if (part === '}') {
                depth = Math.max(depth - 1, 0);
                result = result.trimEnd() + os.EOL + indent.repeat(depth) + '}' + os.EOL + indent.repeat(depth);
            } else if (part === ';') {
                result = result.trimEnd() + ';' + os.EOL + indent.repeat(depth);
            } else {
                result += part.trim();
            }
        }
        return result.trim();
    }

    private static jsonPrettify(text: string, indentSize = 2) {
        const scanner = createScanner(text, true);

        let indentLevel = 0;

        function newLineAndIndent() {
            return os.EOL + ' '.repeat(indentLevel * indentSize);
        }

        function scanNext(): [SyntaxKind, string] {
            const token = scanner.scan();
            const offset = scanner.getTokenOffset();
            const length = scanner.getTokenLength();
            const value = text.substr(offset, length);
            return [ token, value ];
        }

        let [firstToken, firstTokenValue] = scanNext();
        let secondToken: SyntaxKind;
        let secondTokenValue: string;
        let result = '';

        while (firstToken !== SyntaxKind.EOF) {
            [secondToken, secondTokenValue] = scanNext();

            switch (firstToken) {
                case SyntaxKind.OpenBraceToken:
                    result += this.jsonSpecialTokenMapping[firstToken];
                    if (secondToken !== SyntaxKind.CloseBraceToken) {
                        indentLevel++;
                        result += newLineAndIndent();
                    }
                    break;
                case SyntaxKind.OpenBracketToken:
                    result += this.jsonSpecialTokenMapping[firstToken];
                    if (secondToken !== SyntaxKind.CloseBracketToken) {
                        indentLevel++;
                        result += newLineAndIndent();
                    }
                    break;
                case SyntaxKind.CloseBraceToken:
                case SyntaxKind.CloseBracketToken:
                case SyntaxKind.NullKeyword:
                case SyntaxKind.TrueKeyword:
                case SyntaxKind.FalseKeyword:
                    result += this.jsonSpecialTokenMapping[firstToken];
                    if (secondToken === SyntaxKind.CloseBraceToken
                        || secondToken === SyntaxKind.CloseBracketToken) {
                        indentLevel--;
                        result += newLineAndIndent();
                    }
                    break;
                case SyntaxKind.CommaToken:
                    result += this.jsonSpecialTokenMapping[firstToken];
                    if (secondToken === SyntaxKind.CloseBraceToken
                        || secondToken === SyntaxKind.CloseBracketToken) {
                        indentLevel--;
                    }
                    result += newLineAndIndent();
                    break;
                case SyntaxKind.ColonToken:
                    result += this.jsonSpecialTokenMapping[firstToken] + ' ';
                    break;
                case SyntaxKind.StringLiteral:
                case SyntaxKind.NumericLiteral:
                case SyntaxKind.Unknown:
                    result += firstTokenValue;
                    if (secondToken === SyntaxKind.CloseBraceToken
                        || secondToken === SyntaxKind.CloseBracketToken) {
                        indentLevel--;
                        result += newLineAndIndent();
                    }
                    break;
                default:
                    result += firstTokenValue;
            }

            firstToken = secondToken;
            firstTokenValue = secondTokenValue;
        }

        return result;
    }
}