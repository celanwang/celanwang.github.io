import { visit } from 'unist-util-visit';
import type { Element, ElementContent, Root } from 'hast';

function textContent(node: ElementContent | Root): string {
  if (node.type === 'text') return node.value;
  return 'children' in node ? node.children.map(textContent).join(' ') : '';
}

function rows(table: Element): Element[] {
  return table.children.flatMap((child) => {
    if (child.type !== 'element') return [];
    if (child.tagName === 'tr') return [child];
    if (child.tagName === 'thead' || child.tagName === 'tbody') {
      return child.children.filter(
        (row): row is Element => row.type === 'element' && row.tagName === 'tr',
      );
    }
    return [];
  });
}

function cells(row: Element): Element[] {
  return row.children.filter(
    (cell): cell is Element =>
      cell.type === 'element' && (cell.tagName === 'th' || cell.tagName === 'td'),
  );
}

function label(text: string): Element {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: ['table-cell-label'], ariaHidden: 'true' },
    children: [{ type: 'text', value: text }],
  };
}

function enhanceTable(table: Element, index: number): Element {
  const tableRows = rows(table);
  const headers = tableRows[0]
    ? cells(tableRows[0]).map((cell) => textContent(cell).replace(/\s+/g, ' ').trim())
    : [];
  const columnCount = headers.length;
  const layout = columnCount >= 4 ? 'matrix' : columnCount === 3 ? 'stack' : 'key-value';
  const regionId = `table-scroll-${index + 1}`;

  table.properties ??= {};
  table.properties.role ??= 'table';

  tableRows.forEach((row) => {
    row.properties ??= {};
    row.properties.role ??= 'row';
    cells(row).forEach((cell, cellIndex) => {
      cell.properties ??= {};
      if (tableRows[0] !== row && cellIndex === 0) cell.tagName = 'th';
      const isHeader = cell.tagName === 'th';
      if (isHeader) {
        cell.properties.scope = tableRows[0] === row ? 'col' : 'row';
        cell.properties.role = tableRows[0] === row ? 'columnheader' : 'rowheader';
      } else {
        cell.properties.role = 'cell';
        cell.children = [
          label(headers[cellIndex] ?? `Column ${cellIndex + 1}`),
          {
            type: 'element',
            tagName: 'span',
            properties: { className: ['table-cell-value'] },
            children: cell.children,
          },
        ];
      }
    });
  });

  return {
    type: 'element',
    tagName: 'div',
    properties: { className: ['table-frame'], dataLayout: layout },
    children: [
      {
        type: 'element',
        tagName: 'div',
        properties: {
          id: regionId,
          className: ['table-scroll'],
          role: 'region',
          tabIndex: 0,
          ariaLabel: `${headers.join(' / ')} table`,
          ariaDescribedBy: `${regionId}-hint`,
          dataColumns: columnCount,
          dataLayout: layout,
        },
        children: [table],
      },
      {
        type: 'element',
        tagName: 'p',
        properties: {
          id: `${regionId}-hint`,
          className: ['table-scroll-hint'],
          hidden: true,
        },
        children: [
          {
            type: 'element',
            tagName: 'span',
            properties: { ariaHidden: 'true' },
            children: [{ type: 'text', value: '↔' }],
          },
          {
            type: 'text',
            value: ` ${columnCount} columns · scroll horizontally. Focus the table and use ← →.`,
          },
        ],
      },
    ],
  };
}

export function rehypeTableScroll() {
  return (tree: Root) => {
    let tableIndex = 0;
    visit(tree, 'element', (node, index, parent) => {
      if (node.tagName !== 'table' || parent == null || typeof index !== 'number') return;
      parent.children[index] = enhanceTable(node, tableIndex);
      tableIndex += 1;
    });
  };
}
