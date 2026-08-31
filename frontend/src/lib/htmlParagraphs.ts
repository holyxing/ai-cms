const BLOCK_OR_STRUCTURAL_LINE = /^\s*(?:<!--|<!doctype\b|<\/?(?:address|article|aside|blockquote|details|dialog|div|dl|dt|dd|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|main|nav|ol|p|pre|section|table|tbody|thead|tfoot|tr|td|th|ul|li|script|style|template|video|audio|picture|source|img|HY_[A-Z_]+)\b)/i;

export interface ParagraphWrapResult {
  html: string;
  convertedCount: number;
}

/**
 * 将每个非空纯文本行转换为段落，同时保留既有块级 HTML 结构。
 * 分隔符被单独保留，因此 LF、CRLF 和混合换行都不会被改写。
 */
export function wrapPlainTextLinesInParagraphs(source: string): ParagraphWrapResult {
  let convertedCount = 0;
  const parts = source.split(/(\r\n|\n|\r)/);

  const html = parts.map((part, index) => {
    if (index % 2 === 1 || !part.trim() || BLOCK_OR_STRUCTURAL_LINE.test(part)) return part;

    const indentation = part.match(/^\s*/)?.[0] ?? '';
    convertedCount += 1;
    return `${indentation}<p>${part.trim()}</p>`;
  }).join('');

  return { html, convertedCount };
}
