// Ported from vscode-restclient (MIT, Copyright (c) 2016-present Huachao Mao).
// Only the text helpers are kept; prompts and editor access are handled by the request runner.
import * as Constants from './constants';

export interface RequestRangeOptions {
    ignoreCommentLine?: boolean;
    ignoreEmptyLine?: boolean;
    ignoreFileVariableDefinitionLine?: boolean;
    ignoreResponseRange?: boolean;
}

export class Selector {
    public static getRequestRanges(lines: string[], options?: RequestRangeOptions): [number, number][] {
        options = {
            ignoreCommentLine: true,
            ignoreEmptyLine: true,
            ignoreFileVariableDefinitionLine: true,
            ignoreResponseRange: true,
            ...options
        };
        const requestRanges: [number, number][] = [];
        const delimitedLines = this.getDelimiterRows(lines);
        delimitedLines.push(lines.length);

        let prev = -1;
        for (const current of delimitedLines) {
            let start = prev + 1;
            let end = current - 1;
            while (start <= end) {
                const startLine = lines[start];
                if (options.ignoreResponseRange && this.isResponseStatusLine(startLine)) {
                    break;
                }

                if (options.ignoreCommentLine && this.isCommentLine(startLine)
                    || options.ignoreEmptyLine && this.isEmptyLine(startLine)
                    || options.ignoreFileVariableDefinitionLine && this.isFileVariableDefinitionLine(startLine)) {
                    start++;
                    continue;
                }

                const endLine = lines[end];
                if (options.ignoreCommentLine && this.isCommentLine(endLine)
                    || options.ignoreEmptyLine && this.isEmptyLine(endLine)) {
                    end--;
                    continue;
                }

                requestRanges.push([start, end]);
                break;
            }
            prev = current;
        }

        return requestRanges;
    }

    /** Extracts the request text from a block the way REST Client does before resolving variables. */
    public static getRequestText(blockText: string, eol: string): string | null {
        const lines = blockText.split(Constants.LineSplitterRegex);
        const rawLines = lines.filter(l => !this.isCommentLine(l));
        const requestRange = this.getRequestRanges(rawLines)[0];
        if (!requestRange) {
            return null;
        }
        return rawLines.slice(requestRange[0], requestRange[1] + 1).join(eol);
    }

    public static isCommentLine(line: string): boolean {
        return Constants.CommentIdentifiersRegex.test(line);
    }

    public static isEmptyLine(line: string): boolean {
        return line.trim() === '';
    }

    public static isFileVariableDefinitionLine(line: string): boolean {
        return Constants.FileVariableDefinitionRegex.test(line);
    }

    public static isResponseStatusLine(line: string): boolean {
        return Constants.ResponseStatusLineRegex.test(line);
    }

    private static getDelimiterRows(lines: string[]): number[] {
        return Object.entries(lines)
            .filter(([, value]) => Constants.DelimiterRegex.test(value))
            .map(([index, ]) => +index);
    }
}
