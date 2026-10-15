import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { xml } from '@codemirror/lang-xml';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Annotation, Compartment, EditorState, Extension } from '@codemirror/state';
import { Decoration, EditorView, MatchDecorator, placeholder as placeholderExt, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { basicSetup } from 'codemirror';
import { useEffect, useRef } from 'react';

/** Marks programmatic updates so they don't echo back through onChange. */
const externalUpdate = Annotation.define<boolean>();

export type EditorLanguage = 'json' | 'xml' | 'html' | 'javascript' | 'graphql' | 'text';

interface Props {
    value: string;
    onChange?: (value: string) => void;
    language?: EditorLanguage;
    readOnly?: boolean;
    placeholder?: string;
    className?: string;
    wrap?: boolean;
}

// Token colors come from VS Code's debug token variables so they follow the active theme.
const highlight = HighlightStyle.define([
    { tag: [tags.string, tags.special(tags.string)], color: 'var(--vscode-debugTokenExpression-string)' },
    { tag: [tags.number, tags.integer, tags.float], color: 'var(--vscode-debugTokenExpression-number)' },
    { tag: [tags.bool, tags.null, tags.atom], color: 'var(--vscode-debugTokenExpression-boolean)' },
    { tag: [tags.propertyName, tags.attributeName, tags.definition(tags.propertyName)], color: 'var(--vscode-debugTokenExpression-name)' },
    { tag: [tags.keyword, tags.tagName, tags.typeName], color: 'var(--vscode-symbolIcon-keywordForeground, var(--vscode-textLink-foreground))' },
    { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--vscode-descriptionForeground)', fontStyle: 'italic' },
    { tag: tags.invalid, color: 'var(--vscode-errorForeground)' },
]);

const theme = EditorView.theme({
    '&': {
        color: 'var(--vscode-editor-foreground)',
        backgroundColor: 'var(--vscode-editor-background)',
        fontSize: 'var(--vscode-editor-font-size)',
        height: '100%',
    },
    '.cm-scroller': { fontFamily: 'var(--vscode-editor-font-family)', lineHeight: '1.5' },
    '.cm-content': { caretColor: 'var(--vscode-editorCursor-foreground)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--vscode-editorCursor-foreground)' },
    '&.cm-focused': { outline: 'none' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
        backgroundColor: 'var(--vscode-editor-selectionBackground) !important',
    },
    '.cm-activeLine': { backgroundColor: 'var(--vscode-editor-lineHighlightBackground, transparent)' },
    '.cm-gutters': {
        backgroundColor: 'var(--vscode-editorGutter-background, var(--vscode-editor-background))',
        color: 'var(--vscode-editorLineNumber-foreground)',
        border: 'none',
    },
    '.cm-activeLineGutter': {
        backgroundColor: 'transparent',
        color: 'var(--vscode-editorLineNumber-activeForeground)',
    },
    '.cm-foldPlaceholder': {
        backgroundColor: 'var(--vscode-editor-foldBackground, transparent)',
        border: 'none',
        color: 'var(--vscode-descriptionForeground)',
    },
    '.cm-matchingBracket': {
        backgroundColor: 'var(--vscode-editorBracketMatch-background)',
        outline: '1px solid var(--vscode-editorBracketMatch-border)',
    },
    '.cm-searchMatch': { backgroundColor: 'var(--vscode-editor-findMatchHighlightBackground)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--vscode-editor-findMatchBackground)' },
    '.cm-panels': {
        backgroundColor: 'var(--vscode-editorWidget-background)',
        color: 'var(--vscode-editorWidget-foreground)',
    },
    '.cm-panels input, .cm-panels button': { fontSize: '12px' },
    '.cm-tooltip': {
        backgroundColor: 'var(--vscode-editorHoverWidget-background)',
        border: '1px solid var(--vscode-editorHoverWidget-border)',
    },
    '.cm-placeholder': { color: 'var(--vscode-input-placeholderForeground)' },
    '.cm-variable': { color: 'var(--vscode-charts-orange)', fontWeight: '600' },
});

// highlight {{variables}} in bodies
const variableMatcher = new MatchDecorator({
    regexp: /\{\{.+?\}\}/g,
    decoration: Decoration.mark({ class: 'cm-variable' }),
});
const variableHighlighter = ViewPlugin.define(view => ({
    decorations: variableMatcher.createDeco(view),
    update(update: ViewUpdate) {
        this.decorations = variableMatcher.updateDeco(update, this.decorations);
    },
}), { decorations: v => v.decorations });

function languageExtension(language: EditorLanguage | undefined): Extension {
    switch (language) {
        case 'json': return json();
        case 'xml': return xml();
        case 'html': return html();
        case 'javascript': return javascript();
        default: return [];
    }
}

export function CodeEditor({ value, onChange, language, readOnly, placeholder, className, wrap }: Props) {
    const host = useRef<HTMLDivElement>(null);
    const view = useRef<EditorView>();
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const languageCompartment = useRef(new Compartment());
    const readOnlyCompartment = useRef(new Compartment());
    const wrapCompartment = useRef(new Compartment());

    useEffect(() => {
        const editor = new EditorView({
            parent: host.current!,
            state: EditorState.create({
                doc: value,
                extensions: [
                    basicSetup,
                    theme,
                    syntaxHighlighting(highlight),
                    variableHighlighter,
                    placeholder ? placeholderExt(placeholder) : [],
                    languageCompartment.current.of(languageExtension(language)),
                    readOnlyCompartment.current.of([EditorState.readOnly.of(!!readOnly), EditorView.editable.of(!readOnly)]),
                    wrapCompartment.current.of(wrap ? EditorView.lineWrapping : []),
                    EditorView.updateListener.of(update => {
                        if (update.docChanged && !update.transactions.some(t => t.annotation(externalUpdate))) {
                            onChangeRef.current?.(update.state.doc.toString());
                        }
                    }),
                ],
            }),
        });
        view.current = editor;
        return () => editor.destroy();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const editor = view.current;
        if (editor && editor.state.doc.toString() !== value) {
            editor.dispatch({
                changes: { from: 0, to: editor.state.doc.length, insert: value },
                annotations: externalUpdate.of(true),
            });
        }
    }, [value]);

    useEffect(() => {
        view.current?.dispatch({ effects: languageCompartment.current.reconfigure(languageExtension(language)) });
    }, [language]);

    useEffect(() => {
        view.current?.dispatch({
            effects: readOnlyCompartment.current.reconfigure([EditorState.readOnly.of(!!readOnly), EditorView.editable.of(!readOnly)]),
        });
    }, [readOnly]);

    useEffect(() => {
        view.current?.dispatch({ effects: wrapCompartment.current.reconfigure(wrap ? EditorView.lineWrapping : []) });
    }, [wrap]);

    return <div className={`code-editor ${className ?? ''}`} ref={host} />;
}
