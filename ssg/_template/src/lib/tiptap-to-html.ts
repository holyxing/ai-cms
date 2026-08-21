// tiptap-to-html.ts
// 依据: docs/04a-主题与Block-规范.md §2 (Block JSON Schema) + §4.3 (Astro 原生 dispatcher)
//
// P2 范围: 7 种 MVP block (heading/paragraph/image/quote/list/codeBlock/callout)
// 输出: HTML 字符串 (Astro 模板直接插入)
//
// 注: P2 用直接拼接 JSON -> HTML (不用 unified, 因 block 类型少且固定)
//     P2.5 可改 unified 方案, 支持更多 mark
//
// 输入: TiptapNode { type, attrs?, content?, text?, marks? }
// 输出: string (HTML)

type Mark = { type: string; attrs?: Record<string, any> };
type Node = {
  type: string;
  attrs?: Record<string, any>;
  content?: Node[];
  text?: string;
  marks?: Mark[];
};

function escHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderMarks(text: string, marks?: Mark[]): string {
  if (!marks) marks = [];
  let out = escHtml(text);
  for (const m of marks) {
    switch (m.type) {
      case "bold": out = `<strong>${out}</strong>`; break;
      case "italic": out = `<em>${out}</em>`; break;
      case "underline": out = `<u>${out}</u>`; break;
      case "strike": out = `<s>${out}</s>`; break;
      case "code": out = `<code>${out}</code>`; break;
      case "link":
        const href = escHtml(m.attrs?.href || "#");
        const target = m.attrs?.target || "_self";
        out = `<a href="${href}" target="${target}" rel="noopener">${out}</a>`;
        break;
      case "highlight":
        // color 仅接受 token 名 (04a §2.3 决策)
        const tk = String(m.attrs?.color || "yellow");
        out = `<span class="hl-${tk}">${out}</span>`;
        break;
      case "textColor":
        const tkc = String(m.attrs?.color || "primary");
        out = `<span class="text-${tkc}">${out}</span>`;
        break;
      default: break;
    }
  }
  return out;
}

function renderChildren(content: Node[] = []): string {
  return content.map(renderNode).join("");
}

function renderNode(node: Node): string {
  switch (node.type) {
    case "doc":
      return renderChildren(node.content);
    case "text":
      return renderMarks(node.text || "", node.marks);
    case "paragraph":
      return `<p>${renderChildren(node.content)}</p>`;
    case "heading": {
      const level = Math.min(Math.max(node.attrs?.level || 2, 1), 6);
      return `<h${level}>${renderChildren(node.content)}</h${level}>`;
    }
    case "blockquote":
      return `<blockquote>${renderChildren(node.content)}</blockquote>`;
    case "bulletList":
      return `<ul>${renderChildren(node.content)}</ul>`;
    case "orderedList":
      return `<ol>${renderChildren(node.content)}</ol>`;
    case "listItem":
      return `<li>${renderChildren(node.content)}</li>`;
    case "codeBlock": {
      const lang = escHtml(node.attrs?.language || "");
      return `<pre><code class="language-${lang}">${renderChildren(node.content)}</code></pre>`;
    }
    case "image": {
      const src = escHtml(node.attrs?.src || node.attrs?.media_id || "");
      const alt = escHtml(node.attrs?.alt || "");
      return `<img src="${src}" alt="${alt}" loading="lazy" />`;
    }
    case "divider":
      return `<hr />`;
    case "callout": {
      const variant = escHtml(node.attrs?.variant || "info");
      return `<div class="callout callout-${variant}">${renderChildren(node.content)}</div>`;
    }
    default:
      return "";
  }
}

export function tiptapToHtml(node: Node | null | undefined): string {
  if (!node) return "";
  return renderNode(node);
}

export function tiptapBodyToHtml(content: Node[] | undefined): string {
  return tiptapToHtml({ type: "doc", content });
}
