import { describe, expect, it } from 'vitest';
import { wrapPlainTextLinesInParagraphs } from './htmlParagraphs';

describe('wrapPlainTextLinesInParagraphs', () => {
  it('wraps every non-empty plain-text line', () => {
    expect(wrapPlainTextLinesInParagraphs('第一段\n\n第二段')).toEqual({
      html: '<p>第一段</p>\n\n<p>第二段</p>',
      convertedCount: 2,
    });
  });

  it('keeps block HTML and HY tags unchanged', () => {
    const source = '<section>\n已有正文\n<p>已有段落</p>\n<HY_CONTENT_BODY />\n</section>';
    expect(wrapPlainTextLinesInParagraphs(source)).toEqual({
      html: '<section>\n<p>已有正文</p>\n<p>已有段落</p>\n<HY_CONTENT_BODY />\n</section>',
      convertedCount: 1,
    });
  });

  it('wraps inline HTML and preserves indentation and CRLF', () => {
    expect(wrapPlainTextLinesInParagraphs('  <strong>重点</strong>\r\n  普通正文')).toEqual({
      html: '  <p><strong>重点</strong></p>\r\n  <p>普通正文</p>',
      convertedCount: 2,
    });
  });
});
