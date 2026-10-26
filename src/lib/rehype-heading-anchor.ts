import { visit } from 'unist-util-visit';
import GithubSlugger from 'github-slugger';
import type { Element, Root } from 'hast';

/**
 * Appends an empty, hover-revealed anchor link to h2–h4 headings.
 * Ids are assigned with github-slugger when missing — the same algorithm
 * Astro uses — so anchors always match TOC slugs regardless of plugin order.
 */
export function rehypeHeadingAnchor() {
  return (tree: Root) => {
    const slugger = new GithubSlugger();
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'h2' && node.tagName !== 'h3' && node.tagName !== 'h4') return;
      node.properties ??= {};
      let id = typeof node.properties.id === 'string' && node.properties.id ? node.properties.id : null;
      if (!id) {
        const text = textOf(node);
        if (!text) return;
        id = slugger.slug(text);
        node.properties.id = id;
      }

      const existing = node.children.find(
        (child): child is Element =>
          child.type === 'element' &&
          Array.isArray(child.properties?.className) &&
          child.properties.className.includes('heading-anchor')
      );
      if (existing) {
        existing.children = [];
        existing.properties ??= {};
        existing.properties.ariaLabel ??= 'Link to this section';
        return;
      }

      node.children.push({
        type: 'element',
        tagName: 'a',
        properties: {
          className: ['heading-anchor'],
          href: `#${id}`,
          ariaLabel: 'Link to this section',
        },
        children: [],
      });
    });
  };
}

function textOf(node: Element): string {
  return node.children
    .map((c) => (c.type === 'text' ? c.value : c.type === 'element' ? textOf(c) : ''))
    .join('')
    .trim();
}
