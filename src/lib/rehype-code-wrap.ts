import { visit } from 'unist-util-visit';
import type { Element, ElementContent, Root } from 'hast';

const LANG_MAP: Record<string, string> = {
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  py: 'Python',
  python: 'Python',
  go: 'Go',
  golang: 'Go',
  bash: 'Bash',
  shell: 'Shell',
  sh: 'Shell',
  zsh: 'Shell',
  yaml: 'YAML',
  yml: 'YAML',
  json: 'JSON',
  dockerfile: 'Dockerfile',
  docker: 'Dockerfile',
  markdown: 'Markdown',
  md: 'Markdown',
  html: 'HTML',
  css: 'CSS',
  sql: 'SQL',
  rust: 'Rust',
  java: 'Java',
  c: 'C',
  cpp: 'C++',
  toml: 'TOML',
  xml: 'XML',
};

function classList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean);
  return [];
}

function langLabel(raw: string): string {
  const key = raw.trim().toLowerCase();
  if (!key || key === 'plaintext' || key === 'text' || key === 'plain') return 'Text';
  return LANG_MAP[key] || raw;
}

function detectLanguage(pre: Element): string {
  const props = pre.properties ?? {};
  const fromData = props.dataLanguage ?? props['data-language'];
  if (fromData != null && String(fromData).trim()) {
    return langLabel(String(fromData));
  }

  const fromPre = classList(props.className)
    .find((c) => c.startsWith('language-'))
    ?.slice('language-'.length);
  if (fromPre) return langLabel(fromPre);

  const code = pre.children.find(
    (child): child is Element => child.type === 'element' && child.tagName === 'code'
  );
  if (code) {
    const fromCode = classList(code.properties?.className)
      .find((c) => c.startsWith('language-'))
      ?.slice('language-'.length);
    if (fromCode) return langLabel(fromCode);
  }

  return 'Text';
}

function isCodeWrap(node: ElementContent | Root): boolean {
  return (
    node.type === 'element' &&
    node.tagName === 'div' &&
    classList(node.properties?.className).includes('code-wrap')
  );
}

export function rehypeCodeWrap() {
  return (tree: Root) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'pre' || parent == null || typeof index !== 'number') return;
      if (isCodeWrap(parent)) return;

      const label = detectLanguage(node);
      node.properties ??= {};
      node.properties.role ??= 'region';
      node.properties.tabIndex ??= 0;
      node.properties.ariaLabel ??= `${label} code`;
      const wrap: Element = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['code-wrap'] },
        children: [
          {
            type: 'element',
            tagName: 'div',
            properties: { className: ['code-head'] },
            children: [
              {
                type: 'element',
                tagName: 'span',
                properties: { className: ['code-lang'] },
                children: [{ type: 'text', value: label }],
              },
              {
                type: 'element',
                tagName: 'button',
                properties: {
                  type: 'button',
                  className: ['copy-btn'],
                  ariaLabel: 'Copy code',
                },
                children: [],
              },
            ],
          },
          node,
        ],
      };

      parent.children[index] = wrap;
    });
  };
}
