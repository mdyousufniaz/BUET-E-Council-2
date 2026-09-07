// Run with:  node --test frontend/lib/tableCellListNumbering.test.ts
//
// Pure ProseMirror-level tests for the table cell list numbering helpers. No
// DOM / editor needed: we build documents against a minimal schema that mirrors
// the real editor's node names (table / tableRow / tableCell / orderedList /
// bulletList / listItem) and drive the helpers with a real Transaction.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';

import {
  tableListSignature,
  resequenceTableCellLists,
  resequenceAllTables,
} from './tableCellListNumbering.ts';

const cellAttrs = {
  colspan: { default: 1 },
  rowspan: { default: 1 },
  colwidth: { default: null },
};

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
    text: { group: 'inline' },
    orderedList: {
      group: 'block',
      content: 'listItem+',
      attrs: { start: { default: 1 }, style: { default: null } },
      toDOM: (n: any) => ['ol', { start: n.attrs.start }, 0],
    },
    bulletList: {
      group: 'block',
      content: 'listItem+',
      attrs: { style: { default: null } },
      toDOM: () => ['ul', 0],
    },
    listItem: { content: 'paragraph block*', toDOM: () => ['li', 0] },
    table: {
      group: 'block',
      content: 'tableRow+',
      tableRole: 'table',
      isolating: true,
      toDOM: () => ['table', ['tbody', 0]],
    },
    tableRow: {
      content: '(tableCell | tableHeader)*',
      tableRole: 'row',
      toDOM: () => ['tr', 0],
    },
    tableCell: {
      content: 'block+',
      attrs: cellAttrs,
      tableRole: 'cell',
      isolating: true,
      toDOM: () => ['td', 0],
    },
    tableHeader: {
      content: 'block+',
      attrs: cellAttrs,
      tableRole: 'header_cell',
      isolating: true,
      toDOM: () => ['th', 0],
    },
  },
  marks: {},
});

const N = schema.nodes;
const para = (t?: string) => N.paragraph.createChecked(null, t ? schema.text(t) : null);
const li = (t?: string) => N.listItem.createChecked(null, para(t));
const ol = (start: number, items = 1) =>
  N.orderedList.createChecked({ start }, Array.from({ length: items }, () => li('x')));
const ul = () => N.bulletList.createChecked(null, [li('b')]);

const cOl = (start: number, items = 1) => N.tableCell.createChecked(null, ol(start, items));
const cUl = () => N.tableCell.createChecked(null, ul());
const cText = (t: string) => N.tableCell.createChecked(null, para(t));
const cBlank = () => N.tableCell.createChecked(null, para());
const rowOf = (...cells: any[]) => N.tableRow.createChecked(null, cells);
const tableOf = (...rows: any[]) => N.table.createChecked(null, rows);
const docOf = (...blocks: any[]) => N.doc.createChecked(null, blocks);

// Collect every orderedList `start` in document order.
const starts = (doc: any): number[] => {
  const out: number[] = [];
  doc.descendants((n: any) => {
    if (n.type.name === 'orderedList') out.push(n.attrs.start);
  });
  return out;
};

// Run resequenceTableCellLists on the single table at position 0 and return the
// resulting doc + whether it reported a change.
const reseq = (doc: any) => {
  const tr = EditorState.create({ schema, doc }).tr;
  const changed = resequenceTableCellLists(tr, 0);
  return { doc: tr.doc, changed };
};

test('deleting a row closes the gap: [1,2,4] -> [1,2,3]', () => {
  // Post-delete document: the "3" row is gone, leaving starts 1, 2, 4.
  const { doc, changed } = reseq(docOf(tableOf(rowOf(cOl(1)), rowOf(cOl(2)), rowOf(cOl(4)))));
  assert.equal(changed, true);
  assert.deepEqual(starts(doc), [1, 2, 3]);
});

test('deleting the first row still renumbers from 1: [2,3,4] -> [1,2,3]', () => {
  const { doc } = reseq(docOf(tableOf(rowOf(cOl(2)), rowOf(cOl(3)), rowOf(cOl(4)))));
  assert.deepEqual(starts(doc), [1, 2, 3]);
});

test('a freshly inserted blank row is transparent: [1,2,<blank>,9] -> [1,2, ,3]', () => {
  const { doc } = reseq(
    docOf(tableOf(rowOf(cOl(1)), rowOf(cOl(2)), rowOf(cBlank()), rowOf(cOl(9)))),
  );
  assert.deepEqual(starts(doc), [1, 2, 3]); // three lists; blank row has none
});

test('turning a list on in the inserted blank row slots it into the sequence', () => {
  // Blank row now has an <ol> (whatever start the toggle produced).
  const { doc } = reseq(
    docOf(tableOf(rowOf(cOl(1)), rowOf(cOl(2)), rowOf(cOl(1)), rowOf(cOl(9)))),
  );
  assert.deepEqual(starts(doc), [1, 2, 3, 4]);
});

test('a text cell ends the run; the next run restarts at 1', () => {
  const { doc } = reseq(
    docOf(tableOf(rowOf(cOl(1)), rowOf(cText('Heading')), rowOf(cOl(5)), rowOf(cOl(6)))),
  );
  assert.deepEqual(starts(doc), [1, 1, 2]);
});

test('a bullet-list cell also ends the numbered run', () => {
  const { doc } = reseq(
    docOf(tableOf(rowOf(cOl(1)), rowOf(cUl()), rowOf(cOl(5)))),
  );
  assert.deepEqual(starts(doc), [1, 1]);
});

test('multi-item cells advance the count by their item count', () => {
  const { doc } = reseq(
    docOf(tableOf(rowOf(cOl(1, 2)), rowOf(cOl(99)), rowOf(cOl(99)))),
  );
  assert.deepEqual(starts(doc), [1, 3, 4]);
});

test('rectangular selection: columns are numbered independently 1..n down the rows', () => {
  // Simulates "apply numbered list to the whole 3x3 block" where every cell got
  // start=1; each column must end up 1,2,3.
  const { doc } = reseq(
    docOf(
      tableOf(
        rowOf(cOl(1), cOl(1), cOl(1)),
        rowOf(cOl(1), cOl(1), cOl(1)),
        rowOf(cOl(1), cOl(1), cOl(1)),
      ),
    ),
  );
  assert.deepEqual(starts(doc), [1, 1, 1, 2, 2, 2, 3, 3, 3]);
});

test('already-correct numbering is left untouched (changed === false) and is idempotent', () => {
  const good = docOf(tableOf(rowOf(cOl(1)), rowOf(cOl(2)), rowOf(cOl(3))));
  const first = reseq(good);
  assert.equal(first.changed, false);
  assert.deepEqual(starts(first.doc), [1, 2, 3]);
  const second = reseq(first.doc);
  assert.equal(second.changed, false);
});

test('resequenceAllTables handles multiple tables in one document', () => {
  const doc = docOf(
    tableOf(rowOf(cOl(1)), rowOf(cOl(5))),
    para('gap'),
    tableOf(rowOf(cOl(2)), rowOf(cOl(8))),
  );
  const tr = EditorState.create({ schema, doc }).tr;
  const changed = resequenceAllTables(tr, tr.doc);
  assert.equal(changed, true);
  assert.deepEqual(starts(tr.doc), [1, 2, 1, 2]);
});

// --- tableListSignature: what makes the plugin decide to re-sequence ----------

test('tableListSignature is stable for the same document', () => {
  const doc = docOf(tableOf(rowOf(cOl(1)), rowOf(cOl(2))));
  assert.equal(tableListSignature(doc), tableListSignature(doc));
});

test('tableListSignature changes when a table row is added or removed', () => {
  const three = docOf(tableOf(rowOf(cOl(1)), rowOf(cOl(2)), rowOf(cOl(3))));
  const two = docOf(tableOf(rowOf(cOl(1)), rowOf(cOl(2))));
  assert.notEqual(tableListSignature(three), tableListSignature(two));
});

test('tableListSignature changes when a list is toggled on inside a cell', () => {
  const withList = docOf(tableOf(rowOf(cOl(1)), rowOf(cOl(2))));
  const withoutList = docOf(tableOf(rowOf(cOl(1)), rowOf(cBlank())));
  assert.notEqual(tableListSignature(withList), tableListSignature(withoutList));
});

test('tableListSignature ignores list edits outside any table', () => {
  const a = docOf(para('just text'), ol(1));
  const b = docOf(para('just text'), ol(1, 5));
  assert.equal(tableListSignature(a), tableListSignature(b)); // both have no table
});
