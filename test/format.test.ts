import { describe, expect, it } from 'vitest';
import { ResponseFormatUtility } from '../src/extension/core/responseFormatUtility';

describe('ResponseFormatUtility', () => {
    it('formats xml', () => {
        const xml = '<?xml version="1.0"?><root a="1"><item>one</item><item><b>two</b></item><empty/><!-- c --></root>';
        expect(ResponseFormatUtility.formatBody(xml, 'application/xml', true)).toBe([
            '<?xml version="1.0"?>',
            '<root a="1">',
            '  <item>one</item>',
            '  <item>',
            '    <b>two</b>',
            '  </item>',
            '  <empty/>',
            '  <!-- c -->',
            '</root>',
        ].join('\n'));
    });

    it('formats css and json', () => {
        expect(ResponseFormatUtility.formatBody('a{color:red;margin:0}b{x:y}', 'text/css', true))
            .toBe('a {\n  color:red;\n  margin:0\n}\nb {\n  x:y\n}');
        expect(ResponseFormatUtility.formatBody('{"a":[1,{"b":null}]}', 'application/json', true))
            .toBe('{\n  "a": [\n    1,\n    {\n      "b": null\n    }\n  ]\n}');
    });
});
