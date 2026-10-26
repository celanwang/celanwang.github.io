import { visit } from 'unist-util-visit';
import type { Element, ElementContent, Root } from 'hast';

function classList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') return value.split(/\s+/).filter(Boolean);
  return [];
}

function isTableScroll(node: ElementContent | Root): node is Element {
  return (
    node.type === 'element' &&
    node.tagName === 'div' &&
    classList(node.properties?.className).includes('table-scroll')
  );
}

function enhanceTableScroll(node: Element): void {
  node.properties ??= {};
  node.properties.role ??= 'region';
  node.properties.tabIndex ??= 0;
  node.properties.ariaLabel ??= 'Scrollable table';
}

export function rehypeTableScroll() {
  return (tree: Root) => {
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'table' || parent == null || typeof index !== 'number') return;
      if (isTableScroll(parent)) {
        enhanceTableScroll(parent);
        return;
      }

      const scroll: Element = {
        type: 'element',
        tagName: 'div',
        properties: {
          className: ['table-scroll'],
          role: 'region',
          tabIndex: 0,
          ariaLabel: 'Scrollable table',
        },
        children: [node],
      };
      const frame: Element = {
        type: 'element',
        tagName: 'div',
        properties: { className: ['table-frame'] },
        children: [
          scroll,
          {
            type: 'element',
            tagName: 'span',
            properties: {
              className: ['table-scroll-hint'],
              ariaHidden: 'true',
            },
            children: [{ type: 'text', value: 'Scroll horizontally →' }],
          },
        ],
      };

      parent.children[index] = frame;
    });
  };
}
