import { TableMap } from '@tiptap/pm/tables';

// ---------------------------------------------------------------------------
// Table cell list numbering
// ---------------------------------------------------------------------------
// Numbered lists inside table cells are modelled as one <ol start="N"> per cell
// (a single list item each, most of the time) so the numbers can appear to run
// continuously down a column across cell boundaries. When a row is inserted or
// deleted, or a list is toggled inside a cell, the per-cell `start` values have
// to be re-sequenced or a delete leaves "1, 2, 4, 5".
//
// Re-sequencing rule: walk each column top -> bottom. A maximal run of
// vertically adjacent cells whose first child is an <ol> is numbered from 1
// (incrementing by each cell's list-item count). A cell that carries real text
// (or a non-paragraph block such as a bullet list) ends the run; a completely
// blank cell (e.g. a freshly inserted row) is transparent and does not break
// the run -- so an inserted row is numbered only once a list is actually turned
// on in it.
//
// These helpers are pure functions over ProseMirror nodes / transactions so
// they can be unit tested without a DOM or a live editor.

// Cheap fingerprint of everything that can change per-cell list numbering, but
// only for content *inside tables* -- editing a list in the normal document
// body must not trigger a table re-sequence. Changes when a table gains/loses a
// row, an ordered/bullet list, or a list item.
export const tableListSignature = (doc: any): number => {
  let sig = 0;
  let tables = 0;
  doc.descendants((node: any) => {
    if (node.type.name !== 'table') return true;
    tables++;
    let rows = 0;
    let lists = 0;
    let items = 0;
    node.descendants((n: any) => {
      const name = n.type.name;
      if (name === 'tableRow') rows++;
      else if (name === 'orderedList' || name === 'bulletList') lists++;
      else if (name === 'listItem') items++;
    });
    sig = (sig * 31 + rows * 1000003 + lists * 1009 + items) | 0;
    return false; // handled this table's subtree; skip re-descending
  });
  return (sig * 7 + tables) | 0;
};

// Re-number the per-cell ordered lists of the table whose node starts at
// `tablePos`, mutating `tr` in place. Only `start` attributes change, so every
// document position stays stable across the calls. Returns true if anything
// was actually changed.
export const resequenceTableCellLists = (tr: any, tablePos: number): boolean => {
  const table = tr.doc.nodeAt(tablePos);
  if (!table || table.type.name !== 'table') return false;

  let map: any;
  try {
    map = TableMap.get(table);
  } catch {
    return false;
  }
  const tableStart = tablePos + 1;
  let modified = false;

  for (let col = 0; col < map.width; col++) {
    let expected: number | null = null; // null => no active run
    const seen = new Set<number>();

    for (let row = 0; row < map.height; row++) {
      const rel = map.map[row * map.width + col];
      if (seen.has(rel)) continue; // row-spanning cell already handled
      seen.add(rel);

      const cellPos = tableStart + rel;
      const cell = tr.doc.nodeAt(cellPos);
      if (!cell) continue;

      const first = cell.firstChild;
      if (first && first.type.name === 'orderedList') {
        let items = 0;
        first.forEach((li: any) => {
          if (li.type.name === 'listItem') items++;
        });
        items = Math.max(items, 1);

        if (expected === null) expected = 1;
        const cur = first.attrs.start == null ? 1 : first.attrs.start;
        if (cur !== expected) {
          tr.setNodeMarkup(cellPos + 1, undefined, { ...first.attrs, start: expected });
          modified = true;
        }
        expected += items;
      } else {
        const hasText = cell.textContent.trim().length > 0;
        const hasOtherBlock = !!first && first.type.name !== 'paragraph';
        if (hasText || hasOtherBlock) {
          expected = null; // a real content cell ends the run
        }
        // otherwise: blank cell -- leave the run running so inserted rows are
        // skipped rather than resetting the count
      }
    }
  }

  return modified;
};

export const resequenceAllTables = (tr: any, doc: any): boolean => {
  const positions: number[] = [];
  doc.descendants((node: any, pos: number) => {
    if (node.type.name === 'table') positions.push(pos);
  });
  let modified = false;
  for (const pos of positions) {
    if (resequenceTableCellLists(tr, pos)) modified = true;
  }
  return modified;
};
