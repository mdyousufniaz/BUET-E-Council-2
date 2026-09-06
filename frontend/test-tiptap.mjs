import { Editor } from '@tiptap/core';
import Document from '@tiptap/extension-document';
import Text from '@tiptap/extension-text';
import Paragraph from '@tiptap/extension-paragraph';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';

const CustomTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      'data-border': {
        default: null,
        parseHTML: element => element.getAttribute('data-border') || 'full',
        renderHTML: attributes => {
          const borderStyle = attributes['data-border'] || 'full';
          return {
            'data-border': borderStyle,
            class: `meeting-table border-${borderStyle}`,
          };
        },
      },
    };
  },
});

const editor = new Editor({
  extensions: [Document, Text, Paragraph, CustomTable, TableRow, TableHeader, TableCell],
  content: `
    <table>
      <tr>
        <td>Test</td>
      </tr>
    </table>
  `,
});

console.log("Initial HTML:");
console.log(editor.getHTML());

editor.commands.updateAttributes('table', { 'data-border': 'outer' });

console.log("\nAfter update HTML:");
console.log(editor.getHTML());
