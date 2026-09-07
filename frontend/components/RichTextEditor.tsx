"use client";

import React, { Fragment, useEffect, useState, useCallback, useRef, type CSSProperties } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { Table, TableView } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { FontFamily } from '@tiptap/extension-font-family';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import CharacterCount from '@tiptap/extension-character-count';
import Link from '@tiptap/extension-link';
import OrderedList from '@tiptap/extension-ordered-list';
import BulletList from '@tiptap/extension-bullet-list';
import HorizontalRule from '@tiptap/extension-horizontal-rule';
import { goToNextCell, addRowAfter, TableMap } from '@tiptap/pm/tables';
import { TextSelection } from '@tiptap/pm/state';
import { Node, Extension, wrappingInputRule, mergeAttributes } from '@tiptap/core';
import { 
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, 
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Quote, Undo, Redo,
  Table as TableIcon, Trash2, Columns, Rows, Settings, Languages,
  Omega, Search, X, Subscript as SubscriptIcon, Superscript as SuperscriptIcon,
  Palette, Highlighter, Link as LinkIcon, Unlink, Sliders as LineHeightIcon,
  Indent as IndentIcon, Outdent as OutdentIcon, CaseSensitive, FileText,
  ZoomIn, ZoomOut, RotateCw, Eye, SplitSquareVertical, AlertCircle, Info,
  CheckSquare, ArrowLeftRight, Check, Maximize2, Minimize2, Sparkles, Sliders,
  Scissors, Copy, Clipboard, Paintbrush, ArrowDownAZ, Pilcrow, PaintBucket,
  ChevronDown, Grid, Sparkle, Layout, Ruler, Sigma, Keyboard, HelpCircle, Combine, Split,
  RectangleHorizontal, RectangleVertical, Droplets, Square as BorderIcon,
  AlignVerticalJustifyStart, AlignVerticalJustifyCenter, AlignVerticalJustifyEnd
} from 'lucide-react';
import { createPortal } from 'react-dom';
import CustomSelect from './CustomSelect';
import { isBijoyText, convertBijoyToUnicode, convertHtmlBijoyToUnicode } from '../lib/bijoyToUnicode';
import { convertMarkdownTablesToHtml } from '../lib/sanitize';
import { rowResizing } from '../lib/tableRowResizing';
import { toast } from 'sonner';

// Custom TipTap Extension for Font Size
export const FontSize = Extension.create({
  name: 'fontSize',
  addOptions() {
    return {
      types: ['textStyle'],
    };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          fontSize: {
            default: null,
            parseHTML: element => element.style.fontSize?.replace(/['"]+/g, ''),
            renderHTML: attributes => {
              if (!attributes.fontSize) return {};
              return { style: `font-size: ${attributes.fontSize}` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize: (fontSize: string) => ({ chain }: any) => {
        return chain().setMark('textStyle', { fontSize }).run();
      },
      unsetFontSize: () => ({ chain }: any) => {
        return chain().setMark('textStyle', { fontSize: null }).removeEmptyTextStyle().run();
      },
    };
  },
});

// Custom TipTap Extension for Line Height / Line Spacing
export const LineHeight = Extension.create({
  name: 'lineHeight',
  addOptions() {
    return {
      types: ['paragraph', 'heading'],
    };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: element => element.style.lineHeight || null,
            renderHTML: attributes => {
              if (!attributes.lineHeight) return {};
              return { style: `line-height: ${attributes.lineHeight}` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setLineHeight: (lineHeight: string) => ({ chain }: any) => {
        return chain().updateAttributes('paragraph', { lineHeight }).updateAttributes('heading', { lineHeight }).run();
      },
      unsetLineHeight: () => ({ chain }: any) => {
        return chain().updateAttributes('paragraph', { lineHeight: null }).updateAttributes('heading', { lineHeight: null }).run();
      },
    };
  },
});

// Custom Paragraph Shading (Background Color) Extension
export const ParagraphShading = Extension.create({
  name: 'paragraphShading',
  addOptions() {
    return {
      types: ['paragraph', 'heading'],
    };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          shading: {
            default: null,
            parseHTML: element => element.style.backgroundColor || null,
            renderHTML: attributes => {
              if (!attributes.shading) return {};
              return { style: `background-color: ${attributes.shading}; padding: 4px 8px; border-radius: 4px;` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setParagraphShading: (color: string) => ({ chain }: any) => {
        return chain().updateAttributes('paragraph', { shading: color }).updateAttributes('heading', { shading: color }).run();
      },
      unsetParagraphShading: () => ({ chain }: any) => {
        return chain().updateAttributes('paragraph', { shading: null }).updateAttributes('heading', { shading: null }).run();
      },
    };
  },
});

// Custom Indent Extension
export const Indent = Extension.create({
  name: 'indent',
  addOptions() {
    return {
      types: ['paragraph', 'heading', 'listItem'],
      minLevel: 0,
      maxLevel: 8,
    };
  },
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          indent: {
            default: 0,
            parseHTML: element => {
              const marginLeft = element.style.marginLeft;
              if (!marginLeft) return 0;
              return Math.round(parseInt(marginLeft, 10) / 24) || 0;
            },
            renderHTML: attributes => {
              if (!attributes.indent || attributes.indent <= 0) return {};
              return { style: `margin-left: ${attributes.indent * 24}px` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      indent: () => ({ tr, state, dispatch }: any) => {
        const { selection } = state;
        const { $from, $to } = selection;
        tr.doc.nodesBetween($from.pos, $to.pos, (node: any, pos: number) => {
          if (this.options.types.includes(node.type.name)) {
            const currentIndent = node.attrs.indent || 0;
            if (currentIndent < this.options.maxLevel) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: currentIndent + 1 });
            }
          }
        });
        if (dispatch) dispatch(tr);
        return true;
      },
      outdent: () => ({ tr, state, dispatch }: any) => {
        const { selection } = state;
        const { $from, $to } = selection;
        tr.doc.nodesBetween($from.pos, $to.pos, (node: any, pos: number) => {
          if (this.options.types.includes(node.type.name)) {
            const currentIndent = node.attrs.indent || 0;
            if (currentIndent > this.options.minLevel) {
              tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: currentIndent - 1 });
            }
          }
        });
        if (dispatch) dispatch(tr);
        return true;
      },
    };
  },
  addKeyboardShortcuts() {
    return {
      'Tab': () => {
        if (this.editor.isActive('table')) {
          return false;
        }
        return this.editor.commands.indent();
      },
      'Shift-Tab': () => {
        if (this.editor.isActive('table')) {
          return false;
        }
        return this.editor.commands.outdent();
      },
    };
  },
});

// Custom TableCell with Text Orientation / Rotation & Style/Height Attribute
export const CustomTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      'data-text-direction': {
        default: 'horizontal',
        parseHTML: element => element.getAttribute('data-text-direction') || 'horizontal',
        renderHTML: attributes => {
          const dir = attributes['data-text-direction'] || 'horizontal';
          if (dir === 'vertical-rl') {
            return {
              'data-text-direction': 'vertical-rl',
              style: `writing-mode: vertical-rl; transform: rotate(180deg); text-align: center; vertical-align: middle; ${attributes.style || ''}`,
            };
          }
          return { 'data-text-direction': 'horizontal' };
        },
      },
      'style': {
        default: null,
        parseHTML: element => element.getAttribute('style'),
        renderHTML: attributes => {
          if (!attributes.style) return {};
          return { style: attributes.style };
        },
      },
      colspan: {
        default: 1,
        parseHTML: element => parseInt(element.getAttribute('colspan') || '1', 10) || 1,
        renderHTML: attributes => (attributes.colspan > 1 ? { colspan: attributes.colspan } : {}),
      },
      rowspan: {
        default: 1,
        parseHTML: element => parseInt(element.getAttribute('rowspan') || '1', 10) || 1,
        renderHTML: attributes => (attributes.rowspan > 1 ? { rowspan: attributes.rowspan } : {}),
      },
      colwidth: {
        default: null,
        parseHTML: element => {
          const colwidth = element.getAttribute('colwidth');
          return colwidth ? colwidth.split(',').map(item => parseInt(item, 10)) : null;
        },
        renderHTML: attributes => {
          if (!attributes.colwidth) return {};
          return { colwidth: attributes.colwidth.join(',') };
        },
      },
    };
  },
});

// Custom TableHeader with Text Orientation / Rotation & Style/Height Attribute
export const CustomTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      'data-text-direction': {
        default: 'horizontal',
        parseHTML: element => element.getAttribute('data-text-direction') || 'horizontal',
        renderHTML: attributes => {
          const dir = attributes['data-text-direction'] || 'horizontal';
          if (dir === 'vertical-rl') {
            return {
              'data-text-direction': 'vertical-rl',
              style: `writing-mode: vertical-rl; transform: rotate(180deg); text-align: center; vertical-align: middle; ${attributes.style || ''}`,
            };
          }
          return { 'data-text-direction': 'horizontal' };
        },
      },
      'style': {
        default: null,
        parseHTML: element => element.getAttribute('style'),
        renderHTML: attributes => {
          if (!attributes.style) return {};
          return { style: attributes.style };
        },
      },
      colspan: {
        default: 1,
        parseHTML: element => parseInt(element.getAttribute('colspan') || '1', 10) || 1,
        renderHTML: attributes => (attributes.colspan > 1 ? { colspan: attributes.colspan } : {}),
      },
      rowspan: {
        default: 1,
        parseHTML: element => parseInt(element.getAttribute('rowspan') || '1', 10) || 1,
        renderHTML: attributes => (attributes.rowspan > 1 ? { rowspan: attributes.rowspan } : {}),
      },
      colwidth: {
        default: null,
        parseHTML: element => {
          const colwidth = element.getAttribute('colwidth');
          return colwidth ? colwidth.split(',').map(item => parseInt(item, 10)) : null;
        },
        renderHTML: attributes => {
          if (!attributes.colwidth) return {};
          return { colwidth: attributes.colwidth.join(',') };
        },
      },
    };
  },
});

// Custom OrderedList extension with support for start attribute, inline style, and Bangla digit input rules
export const CustomOrderedList = OrderedList.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      start: {
        default: 1,
        parseHTML: element => element.hasAttribute('start') ? parseInt(element.getAttribute('start') || '1', 10) : 1,
        renderHTML: attributes => {
          if (!attributes.start || attributes.start === 1) return {};
          return { start: attributes.start };
        },
      },
      style: {
        default: null,
        parseHTML: element => element.getAttribute('style') || null,
        renderHTML: attributes => {
          if (!attributes.style) return {};
          return { style: attributes.style };
        },
      },
    };
  },
  addInputRules() {
    return [
      ...(this.parent?.() || []),
      wrappingInputRule({
        find: /^([০-৯]+)\.\s$/,
        type: this.type,
        getAttributes: () => ({ style: 'list-style-type: bengali;' }),
      }),
    ];
  },
});

// Custom BulletList extension with support for an inline style attribute,
// mirroring CustomOrderedList — without this, the ribbon's Circle/Square
// bullet options had nowhere to persist their style onto the <ul>, so they
// silently no-opped and every bullet list rendered (and reported back) as
// a plain disc regardless of which style was picked.
export const CustomBulletList = BulletList.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      style: {
        default: null,
        parseHTML: element => element.getAttribute('style') || null,
        renderHTML: attributes => {
          if (!attributes.style) return {};
          return { style: attributes.style };
        },
      },
    };
  },
});

// Custom HorizontalRule that preserves class/style — the default node drops
// both, so every "Page Break" insertion (ribbon buttons and Ctrl+Enter alike)
// lost its `page-break` class and dashed-line style and rendered as an
// indistinguishable plain <hr>.
export const CustomHorizontalRule = HorizontalRule.extend({
  addAttributes() {
    return {
      ...(this.parent?.() || {}),
      class: {
        default: null,
        parseHTML: element => element.getAttribute('class') || null,
        renderHTML: attributes => {
          if (!attributes.class) return {};
          return { class: attributes.class };
        },
      },
      style: {
        default: null,
        parseHTML: element => element.getAttribute('style') || null,
        renderHTML: attributes => {
          if (!attributes.style) return {};
          return { style: attributes.style };
        },
      },
    };
  },
});

export class CustomTableView extends TableView {
  update(node: any) {
    const result = super.update(node);
    if (result && this.table) {
      const borderStyle = node.attrs['data-border'] || 'full';
      const tableStyle = node.attrs['data-table-style'] || 'none';
      const align = node.attrs['data-align'] || 'left';
      this.table.setAttribute('data-border', borderStyle);
      this.table.setAttribute('data-table-style', tableStyle);
      this.table.setAttribute('data-align', align);
      this.table.className = `meeting-table border-${borderStyle} table-style-${tableStyle} table-align-${align}`;
    }
    return result;
  }
}

// Drag-to-resize table rows, the vertical counterpart to the table
// extension's built-in column resizing (which only ships columns).
export const TableRowResizing = Extension.create({
  name: 'tableRowResizing',
  addProseMirrorPlugins() {
    return [rowResizing({ cellMinHeight: 20 })];
  },
});

// Custom Table with Tab Keyboard Shortcut, Shift-Enter Row Navigation & Border options
export const CustomTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      'data-border': {
        default: null,
        parseHTML: element => {
          if (element.getAttribute('data-border')) {
            return element.getAttribute('data-border');
          }
          const className = element.getAttribute('class') || '';
          const match = className.match(/border-(full|outer|header|dashed|thick|none)/);
          if (match) {
            return match[1];
          }
          return 'full';
        },
        renderHTML: attributes => {
          const borderStyle = attributes['data-border'] || 'full';
          return {
            'data-border': borderStyle,
            class: `meeting-table border-${borderStyle}`,
          };
        },
      },
      'data-table-style': {
        default: 'none',
        parseHTML: element => element.getAttribute('data-table-style') || 'none',
        renderHTML: attributes => {
          const tableStyle = attributes['data-table-style'] || 'none';
          return {
            'data-table-style': tableStyle,
            class: `table-style-${tableStyle}`,
          };
        },
      },
      'data-align': {
        default: 'left',
        parseHTML: element => element.getAttribute('data-align') || 'left',
        renderHTML: attributes => {
          const align = attributes['data-align'] || 'left';
          return {
            'data-align': align,
            class: `table-align-${align}`,
          };
        },
      },
    };
  },
  addKeyboardShortcuts() {
    return {
      ...this.parent?.(),
      Tab: ({ editor }) => {
        if (editor.isActive('table')) {
          return handleTableTabNavigationWithView(editor.view, false);
        }
        return false;
      },
      'Shift-Tab': ({ editor }) => {
        if (editor.isActive('table')) {
          return handleTableTabNavigationWithView(editor.view, true);
        }
        return false;
      },
      'Shift-Enter': ({ editor }) => {
        if (editor.isActive('table')) {
          return handleTableShiftEnterNavigation(editor.view);
        }
        return false;
      },
    };
  },
});

const handleTableTabNavigationWithView = (view: any, shiftKey: boolean): boolean => {
  const { state } = view;
  const pos = state.selection.$from;

  let currentCellNode: any = null;
  let currentCellIndex = -1;
  let currentRowIndex = -1;
  let tableNode: any = null;
  let tableDepth = -1;

  for (let d = pos.depth; d > 0; d--) {
    const node = pos.node(d);
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      currentCellNode = node;
    }
    if (node.type.name === 'table') {
      tableNode = node;
      tableDepth = d;
      break;
    }
  }

  if (tableNode && tableDepth > 0) {
    currentRowIndex = pos.index(tableDepth);
    for (let d = pos.depth; d > tableDepth; d--) {
      if (pos.node(d).type.name === 'tableRow') {
        currentCellIndex = pos.index(d);
        break;
      }
    }
  }

  if (!currentCellNode || !tableNode || currentRowIndex < 0 || currentCellIndex < 0 || tableDepth < 1) return false;

  // Extract current cell list attributes
  let isBullet = false;
  let isOrdered = false;
  let listStyle = '';
  let startVal = 1;
  let itemCount = 0;

  currentCellNode.descendants((node: any) => {
    if (node.type.name === 'bulletList') {
      isBullet = true;
      if (node.attrs?.style) listStyle = node.attrs.style;
    }
    if (node.type.name === 'orderedList') {
      isOrdered = true;
      if (node.attrs?.style) listStyle = node.attrs.style;
      if (node.attrs?.start) startVal = parseInt(node.attrs.start, 10) || 1;
    }
    if (node.type.name === 'listItem') {
      itemCount++;
    }
  });

  // Fallback text check for manually typed Bangla / English numbers
  if (!isOrdered && !isBullet) {
    const text = currentCellNode.textContent.trim();
    const banglaMatch = text.match(/^([০-৯]+)[\.\)]/);
    const englishMatch = text.match(/^([0-9]+)[\.\)]/);
    if (banglaMatch) {
      isOrdered = true;
      listStyle = 'list-style-type: bengali;';
      const banglaDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
      const numStr = banglaMatch[1].split('').map((d: string) => banglaDigits.indexOf(d)).join('');
      startVal = parseInt(numStr, 10) || 1;
      itemCount = 1;
    } else if (englishMatch) {
      isOrdered = true;
      listStyle = 'list-style-type: decimal;';
      startVal = parseInt(englishMatch[1], 10) || 1;
      itemCount = 1;
    }
  }

  if (shiftKey) {
    return goToNextCell(-1)(view.state, view.dispatch);
  }

  const isLastRow = currentRowIndex === tableNode.childCount - 1;
  const currentRowNode = tableNode.child(currentRowIndex);
  const isLastCellInRow = currentCellIndex === currentRowNode.childCount - 1;

  if (isLastRow && isLastCellInRow) {
    addRowAfter(view.state, view.dispatch);
    goToNextCell(1)(view.state, view.dispatch);
  } else {
    goToNextCell(1)(view.state, view.dispatch);
  }

  const curState = view.state;
  const newPos = curState.selection.$from;
  let targetCellNode: any = null;
  let targetCellDepth = -1;
  let newRowIndex = -1;

  for (let d = newPos.depth; d > 0; d--) {
    const n = newPos.node(d);
    if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') {
      targetCellNode = n;
      targetCellDepth = d;
    }
    if (n.type.name === 'table') {
      newRowIndex = newPos.index(d);
      break;
    }
  }

  if (targetCellNode && targetCellDepth > 0) {
    let hasText = false;
    let hasList = false;
    targetCellNode.descendants((child: any) => {
      if (child.isText && child.text && child.text.trim().length > 0) hasText = true;
      if (child.type.name === 'bulletList' || child.type.name === 'orderedList') hasList = true;
    });

    if (!hasText && !hasList && (isBullet || isOrdered)) {
      // If Tab moves to a new row (newRowIndex > currentRowIndex), increment startVal by 1.
      // If Tab moves within the same row (newRowIndex === currentRowIndex), preserve the same startVal.
      const isNewRow = newRowIndex > currentRowIndex;
      const targetStartVal = isNewRow ? startVal + (itemCount > 0 ? itemCount : 1) : startVal;

      const tr = curState.tr;
      const schema = curState.schema;
      const cellStart = newPos.start(targetCellDepth);
      const cellEnd = newPos.end(targetCellDepth);

      if (isBullet && schema.nodes.bulletList && schema.nodes.listItem) {
        const listNode = schema.nodes.bulletList.create(
          { style: listStyle || 'list-style-type: disc;' },
          schema.nodes.listItem.create(null, schema.nodes.paragraph.create())
        );
        tr.replaceWith(cellStart, cellEnd, listNode);
        const cursorInsideList = cellStart + 2;
        tr.setSelection(TextSelection.create(tr.doc, cursorInsideList));
        view.dispatch(tr);
      } else if (isOrdered && schema.nodes.orderedList && schema.nodes.listItem) {
        const listNode = schema.nodes.orderedList.create(
          { style: listStyle || 'list-style-type: decimal;', start: targetStartVal },
          schema.nodes.listItem.create(null, schema.nodes.paragraph.create())
        );
        tr.replaceWith(cellStart, cellEnd, listNode);
        const cursorInsideList = cellStart + 2;
        tr.setSelection(TextSelection.create(tr.doc, cursorInsideList));
        view.dispatch(tr);
      }
    }
  }

  return true;
};

const handleTableShiftEnterNavigation = (view: any): boolean => {
  const { state } = view;
  const pos = state.selection.$from;

  let currentCellNode: any = null;
  let currentCellIndex = -1;
  let currentRowIndex = -1;
  let tableNode: any = null;
  let tableDepth = -1;

  for (let d = pos.depth; d > 0; d--) {
    const node = pos.node(d);
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      currentCellNode = node;
    }
    if (node.type.name === 'table') {
      tableNode = node;
      tableDepth = d;
      break;
    }
  }

  if (tableNode && tableDepth > 0) {
    currentRowIndex = pos.index(tableDepth);
    for (let d = pos.depth; d > tableDepth; d--) {
      if (pos.node(d).type.name === 'tableRow') {
        currentCellIndex = pos.index(d);
        break;
      }
    }
  }

  if (!currentCellNode || !tableNode || currentRowIndex < 0 || currentCellIndex < 0 || tableDepth < 1) return false;

  // Extract list info from current cell
  let isBullet = false;
  let isOrdered = false;
  let listStyle = '';
  let startVal = 1;
  let itemCount = 0;

  currentCellNode.descendants((node: any) => {
    if (node.type.name === 'bulletList') {
      isBullet = true;
      if (node.attrs?.style) listStyle = node.attrs.style;
    }
    if (node.type.name === 'orderedList') {
      isOrdered = true;
      if (node.attrs?.style) listStyle = node.attrs.style;
      if (node.attrs?.start) startVal = parseInt(node.attrs.start, 10) || 1;
    }
    if (node.type.name === 'listItem') {
      itemCount++;
    }
  });

  // Fallback check for typed text like "1." or "১."
  if (!isOrdered && !isBullet) {
    const text = currentCellNode.textContent.trim();
    const banglaMatch = text.match(/^([০-৯]+)[\.\)]/);
    const englishMatch = text.match(/^([0-9]+)[\.\)]/);
    if (banglaMatch) {
      isOrdered = true;
      listStyle = 'list-style-type: bengali;';
      const banglaDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
      const numStr = banglaMatch[1].split('').map((d: string) => banglaDigits.indexOf(d)).join('');
      startVal = parseInt(numStr, 10) || 1;
      itemCount = 1;
    } else if (englishMatch) {
      isOrdered = true;
      listStyle = 'list-style-type: decimal;';
      startVal = parseInt(englishMatch[1], 10) || 1;
      itemCount = 1;
    }
  }

  const isLastRow = currentRowIndex === tableNode.childCount - 1;
  if (isLastRow) {
    addRowAfter(view.state, view.dispatch);
  }

  // Re-read fresh state from view
  const curState = view.state;
  const curPos = curState.selection.$from;
  let freshTableNode: any = null;
  let freshTableStartPos = -1;

  for (let d = curPos.depth; d > 0; d--) {
    if (curPos.node(d).type.name === 'table') {
      freshTableNode = curPos.node(d);
      freshTableStartPos = curPos.start(d);
      break;
    }
  }

  if (freshTableNode && freshTableStartPos > 0) {
    const map = TableMap.get(freshTableNode);
    const targetRowIndex = currentRowIndex + 1;
    const targetColIndex = Math.min(currentCellIndex, map.width - 1);

    if (targetRowIndex < map.height) {
      const relativeCellPos = map.map[targetRowIndex * map.width + targetColIndex];
      const targetCellDocPos = freshTableStartPos + relativeCellPos;
      const targetCellNode = curState.doc.nodeAt(targetCellDocPos);

      if (targetCellNode && (targetCellNode.type.name === 'tableCell' || targetCellNode.type.name === 'tableHeader')) {
        const cellStart = targetCellDocPos + 1;
        const cellEnd = targetCellDocPos + targetCellNode.nodeSize - 1;

        let hasText = false;
        let hasList = false;
        targetCellNode.descendants((child: any) => {
          if (child.isText && child.text && child.text.trim().length > 0) hasText = true;
          if (child.type.name === 'bulletList' || child.type.name === 'orderedList') hasList = true;
        });

        const tr = curState.tr;
        const schema = curState.schema;

        if (!hasText && !hasList && (isBullet || isOrdered)) {
          if (isBullet && schema.nodes.bulletList && schema.nodes.listItem) {
            const listNode = schema.nodes.bulletList.create(
              { style: listStyle || 'list-style-type: disc;' },
              schema.nodes.listItem.create(null, schema.nodes.paragraph.create())
            );
            tr.replaceWith(cellStart, cellEnd, listNode);
            tr.setSelection(TextSelection.create(tr.doc, cellStart + 2));
            view.dispatch(tr);
          } else if (isOrdered && schema.nodes.orderedList && schema.nodes.listItem) {
            // Increment list label number by itemCount (or 1) when moving DOWN via Shift+Enter
            const nextStart = startVal + (itemCount > 0 ? itemCount : 1);
            const listNode = schema.nodes.orderedList.create(
              { style: listStyle || 'list-style-type: decimal;', start: nextStart },
              schema.nodes.listItem.create(null, schema.nodes.paragraph.create())
            );
            tr.replaceWith(cellStart, cellEnd, listNode);
            tr.setSelection(TextSelection.create(tr.doc, cellStart + 2));
            view.dispatch(tr);
          }
        } else {
          tr.setSelection(TextSelection.create(tr.doc, cellStart + 1));
          view.dispatch(tr);
        }
      }
    }
  }

  return true;
};

const ColumnSection = Node.create({
  name: 'columnSection',
  group: 'block',
  content: 'block+',
  defining: true,
  isolating: false,

  addAttributes() {
    return {
      cols: {
        default: 2,
        parseHTML: (element: HTMLElement) => parseInt(element.getAttribute('data-cols') || '2', 10),
        renderHTML: (attributes: Record<string, any>) => ({
          'data-cols': attributes.cols,
          class: `column-section cols-${attributes.cols}`,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div.column-section',
      },
    ];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return ['div', mergeAttributes(HTMLAttributes), 0];
  },
});

const ColumnBreak = Node.create({
  name: 'columnBreak',
  group: 'block',
  selectable: true,
  draggable: true,

  parseHTML() {
    return [
      { tag: 'div.column-break' },
      { tag: 'p.column-break' },
    ];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        class: 'column-break text-[10px] font-mono text-amber-600 dark:text-amber-400 py-1 my-1 border-b border-dashed border-amber-500/40 select-none cursor-pointer flex items-center justify-center gap-1 bg-amber-500/10 rounded',
        style: 'break-before: column; page-break-before: column;',
      }),
      '--- Column Break (Press Backspace to remove) ---',
    ];
  },

  addCommands() {
    return {
      insertColumnBreak:
        () =>
        ({ chain }: { chain: any }) => {
          return chain()
            .insertContent([
              {
                type: 'columnBreak',
              },
              {
                type: 'paragraph',
              },
            ])
            .run();
        },
    };
  },
});

const ColumnItem = Node.create({
  name: 'columnItem',
  content: 'block+',
  group: 'columnItemGroup',
  defining: true,
  isolating: false,

  parseHTML() {
    return [{ tag: 'div[data-type="column-item"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'column-item',
        style: 'flex: 1 1 0%; min-width: 0; min-height: 80px; padding: 12px; border: 1px dashed rgba(var(--primary-rgb,99,102,241),0.4); border-radius: 8px; box-sizing: border-box; transition: border-color 0.15s;',
      }),
      0,
    ];
  },
});

const ColumnGroup = Node.create({
  name: 'columnGroup',
  group: 'block',
  content: 'columnItem+',
  defining: true,
  isolating: false,

  addAttributes() {
    return {
      cols: {
        default: 2,
        parseHTML: (element: HTMLElement) => parseInt(element.getAttribute('data-cols') || '2', 10),
        renderHTML: (attributes: Record<string, any>) => ({
          'data-cols': attributes.cols,
          'data-type': 'column-group',
          style: `display: grid; grid-template-columns: repeat(${attributes.cols}, minmax(0, 1fr)); gap: 1.5rem; margin: 1rem 0; width: 100%; box-sizing: border-box;`,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="column-group"]' }];
  },

  renderHTML({ HTMLAttributes }: { HTMLAttributes: Record<string, any> }) {
    return ['div', mergeAttributes(HTMLAttributes), 0];
  },

  addCommands() {
    return {
      insertColumnGroup:
        (cols: 2 | 3) =>
        ({ chain }: { chain: any }) => {
          const items = Array.from({ length: cols }).map(() => ({
            type: 'columnItem',
            content: [{ type: 'paragraph' }],
          }));
          return chain()
            .insertContent([
              {
                type: 'columnGroup',
                attrs: { cols },
                content: items,
              },
              // Insert a paragraph after so cursor can exit the group
              { type: 'paragraph' },
            ])
            .run();
        },
    };
  },
});

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    fontSize: {
      setFontSize: (fontSize: string) => ReturnType;
      unsetFontSize: () => ReturnType;
    };
    lineHeight: {
      setLineHeight: (lineHeight: string) => ReturnType;
      unsetLineHeight: () => ReturnType;
    };
    indent: {
      indent: () => ReturnType;
      outdent: () => ReturnType;
    };
    columnBreak: {
      insertColumnBreak: () => ReturnType;
    };
    columnGroup: {
      insertColumnGroup: (cols: 2 | 3) => ReturnType;
    };
    paragraphShading: {
      setParagraphShading: (color: string) => ReturnType;
      unsetParagraphShading: () => ReturnType;
    };
  }
}

const FONT_SIZE_STEPS = ['10px', '11px', '12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px', '36px', '48px', '72px'];

const SYMBOL_CATEGORIES = [
  {
    name: "Bangla & Administrative",
    symbols: ["৳", "।", "॥", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯", "০", "ক", "খ", "গ", "ঘ", "নথি নং:", "স্মারক নং:", "তারিখ:", "সংযুক্তি:", "স্বাক্ষর:", "অনুলিপি:"]
  },
  {
    name: "Currency & Legal",
    symbols: ["৳", "$", "€", "£", "¥", "₹", "§", "¶", "†", "‡", "©", "®", "™", "№", "℅", "℀", "※", "⁂", "❡", "⁑"]
  },
  {
    name: "Math & Science",
    symbols: ["±", "×", "÷", "≠", "≈", "≤", "≥", "√", "∛", "∜", "∞", "µ", "π", "Ω", "∑", "∏", "∆", "∇", "∂", "∫", "∬", "∮", "≡", "≢", "≅", "∝", "∈", "∉", "⊂", "⊃", "⊆", "⊇", "∪", "∩", "∅", "⊥", "∠", "∟", "%", "‰", "‱", "°", "′", "″", "Å"]
  },
  {
    name: "Greek Lowercase",
    symbols: ["α", "β", "γ", "δ", "ε", "ζ", "η", "θ", "ι", "κ", "λ", "μ", "ν", "ξ", "ο", "π", "ρ", "σ", "τ", "υ", "φ", "χ", "ψ", "ω"]
  },
  {
    name: "Greek Uppercase",
    symbols: ["Α", "Β", "Γ", "Δ", "Ε", "Ζ", "Η", "Θ", "Ι", "Κ", "Λ", "Μ", "Ν", "Ξ", "Ο", "Π", "Ρ", "Σ", "Τ", "Υ", "Φ", "Χ", "Ψ", "Ω"]
  },
  {
    name: "Punctuation & Quotes",
    symbols: ["‘", "’", "“", "”", "«", "»", "‹", "›", "–", "—", "…", "•", "·", "°", "⟨", "⟩", "⌈", "⌉", "⌊", "⌋"]
  },
  {
    name: "Fractions & Scripts",
    symbols: ["½", "⅓", "⅔", "¼", "¾", "⅕", "⅖", "⅗", "⅘", "⅙", "⅚", "⅛", "⅜", "⅝", "⅞", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹", "⁰", "ⁿ", "₀", "₁", "₂", "₃", "₄", "₅", "₆", "₇", "₈", "₉"]
  },
  {
    name: "Arrows & Flow",
    symbols: ["←", "→", "↑", "↓", "↔", "↕", "↖", "↗", "↘", "↙", "⇒", "⇔", "➔", "►", "▼", "◄", "▲", "↵", "↛", "⇄", "⇅"]
  },
  {
    name: "Bullets & Checkmarks",
    symbols: ["✓", "✔", "✕", "✖", "✗", "✘", "☑", "☒", "☐", "★", "☆", "■", "□", "▪", "▫", "▲", "Δ", "○", "●", "◆", "◇", "♦", "◊"]
  }
];

const EQUATION_PRESETS = [
  {
    name: "Quadratic Formula",
    category: "Algebra",
    formula: "x = (-b ± √(b² - 4ac)) / 2a",
    html: `<span class="math-equation font-mono bg-muted/40 px-2.5 py-1 rounded border border-border inline-block">x = <sup>-b ± &radic;(b<sup>2</sup> - 4ac)</sup>&frasl;<sub>2a</sub></span>`
  },
  {
    name: "Area of a Circle",
    category: "Geometry",
    formula: "A = πr²",
    html: `<span class="math-equation font-mono bg-muted/40 px-2.5 py-1 rounded border border-border inline-block">A = &pi;r<sup>2</sup></span>`
  },
  {
    name: "Pythagorean Theorem",
    category: "Geometry",
    formula: "a² + b² = c²",
    html: `<span class="math-equation font-mono bg-muted/40 px-2.5 py-1 rounded border border-border inline-block">a<sup>2</sup> + b<sup>2</sup> = c<sup>2</sup></span>`
  },
  {
    name: "Binomial Theorem",
    category: "Algebra",
    formula: "(x + a)ⁿ = ∑ₖ (ⁿₖ) xⁿ⁻ᵏ aᵏ",
    html: `<span class="math-equation font-mono bg-muted/40 px-2.5 py-1 rounded border border-border inline-block">(x + a)<sup>n</sup> = &sum;<sub>k=0</sub><sup>n</sup> (<sup>n</sup><sub>k</sub>) x<sup>n-k</sup>a<sup>k</sup></span>`
  },
  {
    name: "Mass-Energy Equivalence",
    category: "Physics",
    formula: "E = mc²",
    html: `<span class="math-equation font-mono bg-muted/40 px-2.5 py-1 rounded border border-border inline-block">E = mc<sup>2</sup></span>`
  },
  {
    name: "Definite Integral",
    category: "Calculus",
    formula: "∫ₐᵇ f(x) dx",
    html: `<span class="math-equation font-mono bg-muted/40 px-2.5 py-1 rounded border border-border inline-block">&int;<sub>a</sub><sup>b</sup> f(x) dx</span>`
  },
  {
    name: "Summation Series",
    category: "Calculus",
    formula: "∑ᵢ₌₁ⁿ xᵢ",
    html: `<span class="math-equation font-mono bg-muted/40 px-2.5 py-1 rounded border border-border inline-block">&sum;<sub>i=1</sub><sup>n</sup> x<sub>i</sub></span>`
  },
  {
    name: "Fraction Preset",
    category: "Basic Math",
    formula: "a / b",
    html: `<span class="math-equation font-mono bg-muted/40 px-2.5 py-1 rounded border border-border inline-block"><sup>a</sup>&frasl;<sub>b</sub></span>`
  },
  {
    name: "Square Root / Radical",
    category: "Basic Math",
    formula: "√(x² + y²)",
    html: `<span class="math-equation font-mono bg-muted/40 px-2.5 py-1 rounded border border-border inline-block">&radic;(x<sup>2</sup> + y<sup>2</sup>)</span>`
  },
  {
    name: "Bangla Triangle Area",
    category: "বাংলা গণিত",
    formula: "ক্ষেত্রফল = (১/২) × ভূমি × উচ্চতা",
    html: `<span class="math-equation bg-muted/40 px-2.5 py-1 rounded border border-border inline-block">ক্ষেত্রফল = &frac12; &times; ভূমি &times; উচ্চতা</span>`
  },
  {
    name: "Bangla Circle Perimeter",
    category: "বাংলা গণিত",
    formula: "পরিধি = ২πr",
    html: `<span class="math-equation bg-muted/40 px-2.5 py-1 rounded border border-border inline-block">পরিধি = ২&pi;r</span>`
  }
];

const KEYBOARD_SHORTCUTS_DATA = [
  {
    category: "Indentation & Paragraphs",
    shortcuts: [
      { key: "Tab", desc: "Increase Paragraph / List Indent (Shift Right) — moves to the next cell instead if the cursor is inside a table" },
      { key: "Shift + Tab", desc: "Decrease Paragraph / List Indent (Shift Left) — moves to the previous cell instead if the cursor is inside a table" },
      { key: "Ctrl + L", desc: "Align Text Left" },
      { key: "Ctrl + E", desc: "Align Text Center" },
      { key: "Ctrl + R", desc: "Align Text Right" },
      { key: "Ctrl + J", desc: "Justify Paragraph Alignment" }
    ]
  },
  {
    category: "Tables",
    shortcuts: [
      { key: "Ctrl + Alt + T", desc: "Open Insert Table Dialog" },
      { key: "Tab", desc: "Move to Next Cell (creates a new row if pressed in the last cell)" },
      { key: "Shift + Tab", desc: "Move to Previous Cell" },
      { key: "Shift + Enter", desc: "Move to the Same Column in the Next Row (continuing a bullet/number list into it)" }
    ]
  },
  {
    category: "Page Layout",
    shortcuts: [
      { key: "Ctrl + Enter", desc: "Insert Page Break at Cursor" },
      { key: "Ctrl + Alt + P", desc: "Toggle Word A4 Page View / Fluid Canvas" }
    ]
  },
  {
    category: "Text Formatting & Styles",
    shortcuts: [
      { key: "Ctrl + B", desc: "Toggle Bold Styling" },
      { key: "Ctrl + I", desc: "Toggle Italic Styling" },
      { key: "Ctrl + U", desc: "Toggle Underline Styling" },
      { key: "Ctrl + Shift + X", desc: "Toggle Strikethrough Text" },
      { key: "Ctrl + Shift + +", desc: "Toggle Superscript (x²)" },
      { key: "Ctrl + +", desc: "Toggle Subscript (x₂)" }
    ]
  },
  {
    category: "Clipboard & Editing",
    shortcuts: [
      { key: "Ctrl + C", desc: "Copy Selected Text / Content" },
      { key: "Ctrl + X", desc: "Cut Selected Text" },
      { key: "Ctrl + V", desc: "Paste (Auto-converts Bijoy text to Unicode)" },
      { key: "Ctrl + Z", desc: "Undo Last Action" },
      { key: "Ctrl + Y", desc: "Redo Last Action" },
      { key: "Ctrl + F", desc: "Open Find & Replace Tool" },
      { key: "Ctrl + K", desc: "Insert / Edit Hyperlink" }
    ]
  },
  {
    category: "View & Navigation",
    shortcuts: [
      { key: "Ctrl + /", desc: "Open Keyboard Shortcuts Guide" },
      { key: "Ctrl + Shift + F", desc: "Toggle Full Screen Window Mode" },
      { key: "Esc", desc: "Exit Fullscreen Mode or Close Open Modals" }
    ]
  }
];

const BANGLA_KEYBOARD_DATA = {
  vowels: ['অ', 'আ', 'ই', 'ঈ', 'উ', 'ঊ', 'ঋ', 'এ', 'ঐ', 'ও', 'ঔ'],
  matras: ['া', 'ি', 'ী', 'ু', 'ূ', 'ৃ', 'ে', 'ৈ', 'ো', 'ৌ', '্', 'ং', 'ঃ', 'ঁ'],
  consonants: [
    'ক', 'খ', 'গ', 'ঘ', 'ঙ',
    'চ', 'ছ', 'জ', 'ঝ', 'ঞ',
    'ট', 'ঠ', 'ড', 'ঢ', 'ণ',
    'ত', 'থ', 'দ', 'ধ', 'ন',
    'প', 'ফ', 'ব', 'ভ', 'ম',
    'য', 'র', 'ল', 'শ', 'ষ',
    'স', 'হ', 'ড়', 'ঢ়', 'য়', 'ৎ'
  ],
  digits: ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'],
  quickPhrases: [
    '১.', '২.', '৩.', '৪.', '৫.',
    'ক.', 'খ.', 'গ.', 'ঘ.', 'ঙ.',
    '(১)', '(২)', '(৩)', '(ক)', '(খ)',
    'তারিখ:', 'স্মারক নং:', 'বিষয়:', 'অনুলিপি:', 'ধন্যবাদান্তে,'
  ]
};

const PRESET_TEXT_COLORS = [
  { label: 'Default', color: '' },
  { label: 'Black', color: '#000000' },
  { label: 'Dark Gray', color: '#4b5563' },
  { label: 'BUET Crimson Red', color: '#800000' },
  { label: 'Primary Blue', color: '#2563eb' },
  { label: 'Emerald Green', color: '#059669' },
  { label: 'Amber Orange', color: '#d97706' },
  { label: 'Purple', color: '#7c3aed' },
];

const PRESET_HIGHLIGHT_COLORS = [
  { label: 'None', color: '' },
  { label: 'Yellow Highlight', color: '#fef08a' },
  { label: 'Green Highlight', color: '#bbf7d0' },
  { label: 'Cyan Highlight', color: '#a5f3fc' },
  { label: 'Pink Highlight', color: '#fbcfe8' },
  { label: 'Orange Highlight', color: '#fed7aa' },
];

export type PageSize = 'A4' | 'Letter' | 'Legal' | 'A3';
export type PageOrientation = 'portrait' | 'landscape';
export interface PageMargins { top: number; right: number; bottom: number; left: number; }
export interface PageSettings {
  size: PageSize;
  orientation: PageOrientation;
  margins: PageMargins;
  marginPreset: 'normal' | 'narrow' | 'moderate' | 'wide' | 'custom';
  pageColor: string;
  border: { enabled: boolean; style: 'solid' | 'double' | 'dashed' | 'dotted'; width: number; color: string };
  watermark: { enabled: boolean; text: string; color: string; opacity: number };
}

export const DEFAULT_PAGE_SETTINGS: PageSettings = {
  size: 'A4',
  orientation: 'portrait',
  margins: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
  marginPreset: 'normal',
  pageColor: '',
  border: { enabled: false, style: 'solid', width: 1, color: '#800000' },
  watermark: { enabled: false, text: 'CONFIDENTIAL', color: '#94a3b8', opacity: 0.25 },
};

const PAGE_SIZES_MM: Record<PageSize, [number, number]> = {
  A4: [210, 297],
  Letter: [215.9, 279.4],
  Legal: [215.9, 355.6],
  A3: [297, 420],
};

const MARGIN_PRESETS: Record<'normal' | 'narrow' | 'moderate' | 'wide', PageMargins> = {
  normal: { top: 25.4, right: 25.4, bottom: 25.4, left: 25.4 },
  narrow: { top: 12.7, right: 12.7, bottom: 12.7, left: 12.7 },
  moderate: { top: 25.4, right: 19.05, bottom: 25.4, left: 19.05 },
  wide: { top: 25.4, right: 50.8, bottom: 25.4, left: 50.8 },
};

const PRESET_PAGE_COLORS = [
  { label: 'None', color: '' },
  { label: 'Ivory', color: '#fffdf5' },
  { label: 'Light Blue', color: '#eef4ff' },
  { label: 'Light Gray', color: '#f4f4f5' },
  { label: 'Light Rose', color: '#fff1f2' },
  { label: 'Light Green', color: '#f0fdf4' },
];

const PRESET_SHADING_COLORS = [
  { label: 'No Shading', color: '' },
  { label: 'Light Blue Shading', color: '#e0f2fe' },
  { label: 'Light Yellow Shading', color: '#fef9c3' },
  { label: 'Light Green Shading', color: '#dcfce7' },
  { label: 'Light Rose Shading', color: '#ffe4e6' },
  { label: 'Light Gray Shading', color: '#f3f4f6' },
  { label: 'BUET Crimson Tint', color: '#fdf2f2' }
];

const WORD_QUICK_STYLES = [
  { 
    id: 'normal', 
    name: 'Normal', 
    preview: 'AaBbCc', 
    desc: 'Default Text', 
    action: (e: any) => {
      if (!e.state.selection.empty) {
        e.chain().focus().unsetFontSize().unsetBold().unsetItalic().unsetColor().run();
      } else {
        e.chain().focus().setParagraph().unsetFontSize().unsetBold().unsetItalic().run();
      }
    } 
  },
  { 
    id: 'no_spacing', 
    name: 'No Spacing', 
    preview: 'AaBbCc', 
    desc: 'Compact Lines', 
    action: (e: any) => e.chain().focus().setLineHeight('1.0').run() 
  },
  { 
    id: 'heading1', 
    name: 'Heading 1', 
    preview: 'Heading 1', 
    desc: 'Title 26px Bold', 
    action: (e: any) => {
      if (!e.state.selection.empty) {
        e.chain().focus().setFontSize('26px').setBold().run();
      } else {
        e.chain().focus().unsetFontSize().toggleHeading({ level: 1 }).run();
      }
    } 
  },
  { 
    id: 'heading2', 
    name: 'Heading 2', 
    preview: 'Heading 2', 
    desc: 'Section 20px Bold', 
    action: (e: any) => {
      if (!e.state.selection.empty) {
        e.chain().focus().setFontSize('20px').setBold().run();
      } else {
        e.chain().focus().unsetFontSize().toggleHeading({ level: 2 }).run();
      }
    } 
  },
  { 
    id: 'heading3', 
    name: 'Heading 3', 
    preview: 'Heading 3', 
    desc: 'Subsection 17px', 
    action: (e: any) => {
      if (!e.state.selection.empty) {
        e.chain().focus().setFontSize('17px').setBold().run();
      } else {
        e.chain().focus().unsetFontSize().toggleHeading({ level: 3 }).run();
      }
    } 
  },
  { 
    id: 'title', 
    name: 'Title', 
    preview: 'TITLE', 
    desc: 'Main Doc Title', 
    action: (e: any) => {
      if (!e.state.selection.empty) {
        e.chain().focus().setFontSize('32px').setBold().run();
      } else {
        e.chain().focus().setFontSize('32px').setBold().setTextAlign('center').run();
      }
    } 
  },
  { 
    id: 'subtitle', 
    name: 'Subtitle', 
    preview: 'Subtitle', 
    desc: 'Italic Subtitle', 
    action: (e: any) => {
      if (!e.state.selection.empty) {
        e.chain().focus().setFontSize('18px').setItalic().run();
      } else {
        e.chain().focus().setFontSize('18px').setItalic().setTextAlign('center').run();
      }
    } 
  },
  { id: 'subtle_emphasis', name: 'Subtle Emphasis', preview: 'Emphasis', desc: 'Italic Soft Text', action: (e: any) => e.chain().focus().setItalic().setColor('#6b5c58').run() },
  { id: 'intense_emphasis', name: 'Intense Emphasis', preview: 'Emphasis!', desc: 'Bold Crimson Accent', action: (e: any) => e.chain().focus().setBold().setItalic().setColor('#800000').run() },
  { id: 'quote', name: 'Quote', preview: '“ Quote ”', desc: 'Blockquote Style', action: (e: any) => e.chain().focus().toggleBlockquote().run() }
];

const BULLET_LIST_OPTIONS = [
  { id: 'disc', name: 'Disc Bullet', prefix: '•', type: 'bullet', style: 'disc' },
  { id: 'circle', name: 'Circle Bullet', prefix: '◦', type: 'bullet', style: 'circle' },
  { id: 'square', name: 'Square Bullet', prefix: '▪', type: 'bullet', style: 'square' },
  { id: 'decimal', name: 'English Numbers (1, 2, 3)', prefix: '1.', type: 'ordered', style: 'decimal' },
  { id: 'bengali', name: 'Bangla Numbers (১, ২, ৩)', prefix: '১.', type: 'ordered', style: 'bengali' },
  { id: 'upper-roman', name: 'Roman Numerals (I, II, III)', prefix: 'I.', type: 'ordered', style: 'upper-roman' },
  { id: 'lower-alpha', name: 'Alphabetic (a, b, c)', prefix: 'a.', type: 'ordered', style: 'lower-alpha' },
];

interface MenuBarProps {
  editor: any;
  viewMode: 'fluid' | 'pageView';
  setViewMode: (mode: 'fluid' | 'pageView') => void;
  zoomLevel: number;
  setZoomLevel: (zoom: number) => void;
  onOpenFindReplace: () => void;
  isFullscreen: boolean;
  setIsFullscreen: (val: boolean) => void;
  showParagraphMarks: boolean;
  setShowParagraphMarks: (val: boolean) => void;
  showRuler: boolean;
  setShowRuler: (val: boolean) => void;
  pageSettings: PageSettings;
  setPageSettings: React.Dispatch<React.SetStateAction<PageSettings>>;
}

// Popover that portals to <body> with fixed positioning so it can't be clipped by an
// ancestor's overflow (the ribbon toolbar sets overflow-x-auto, which per the CSS spec
// forces overflow-y to auto too, silently clipping any plain `absolute` dropdown).
const LayoutPopover = ({
  open,
  anchorRef,
  onClose,
  children,
  className = '',
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
}) => {
  const [style, setStyle] = useState<React.CSSProperties>({});
  const [mounted, setMounted] = useState(false);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    const update = () => {
      if (!anchorRef.current) return;
      const rect = anchorRef.current.getBoundingClientRect();
      setStyle({ position: 'fixed', top: rect.bottom + 4, left: rect.left, zIndex: 100005 });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as globalThis.Node;
      if (popRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, onClose, anchorRef]);

  if (!open || !mounted) return null;
  return createPortal(
    <div
      ref={popRef}
      style={style}
      className={`p-2.5 bg-popover border border-border rounded-xl shadow-xl flex flex-col gap-1.5 ${className}`}
    >
      {children}
    </div>,
    document.body
  );
};

const MenuBar = ({
  editor,
  viewMode,
  setViewMode,
  zoomLevel,
  setZoomLevel,
  onOpenFindReplace,
  isFullscreen,
  setIsFullscreen,
  showParagraphMarks,
  setShowParagraphMarks,
  showRuler,
  setShowRuler,
  pageSettings,
  setPageSettings
}: MenuBarProps) => {
  const [activeTab, setActiveTab] = useState<'home' | 'insert' | 'table' | 'layout' | 'tools' | 'view'>('home');
  const [isSymbolModalOpen, setIsSymbolModalOpen] = useState(false);
  const [isEquationModalOpen, setIsEquationModalOpen] = useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [isBanglaKeyboardOpen, setIsBanglaKeyboardOpen] = useState(false);
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkOpenNewTab, setLinkOpenNewTab] = useState(true);
  const [tableBorderOption, setTableBorderOption] = useState<string>('full');
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const [symbolSearch, setSymbolSearch] = useState('');
  const [equationSearch, setEquationSearch] = useState('');
  const [shortcutsSearch, setShortcutsSearch] = useState('');
  const [customEquationInput, setCustomEquationInput] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [hoverRows, setHoverRows] = useState(0);
  const [hoverCols, setHoverCols] = useState(0);
  const [customRows, setCustomRows] = useState(3);
  const [customCols, setCustomCols] = useState(3);
  const [mounted, setMounted] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [showShadingPicker, setShowShadingPicker] = useState(false);
  const [formatPainterActive, setFormatPainterActive] = useState(false);
  const [storedFormat, setStoredFormat] = useState<any>(null);
  const [showMarginsPicker, setShowMarginsPicker] = useState(false);
  const [showSizePicker, setShowSizePicker] = useState(false);
  const [showColumnsPicker, setShowColumnsPicker] = useState(false);
  const [showBreaksPicker, setShowBreaksPicker] = useState(false);
  const [showPageColorPicker, setShowPageColorPicker] = useState(false);
  const [showBorderPicker, setShowBorderPicker] = useState(false);
  const [showWatermarkPicker, setShowWatermarkPicker] = useState(false);
  const [customMargins, setCustomMargins] = useState<PageMargins>(pageSettings.margins);
  const marginsBtnRef = useRef<HTMLButtonElement>(null);
  const sizeBtnRef = useRef<HTMLButtonElement>(null);
  const columnsBtnRef = useRef<HTMLButtonElement>(null);
  const breaksBtnRef = useRef<HTMLButtonElement>(null);
  const watermarkBtnRef = useRef<HTMLButtonElement>(null);
  const pageColorBtnRef = useRef<HTMLButtonElement>(null);
  const borderBtnRef = useRef<HTMLButtonElement>(null);
  const cellShadingBtnRef = useRef<HTMLButtonElement>(null);

  const closeLayoutPickers = () => {
    setShowMarginsPicker(false);
    setShowSizePicker(false);
    setShowColumnsPicker(false);
    setShowBreaksPicker(false);
    setShowPageColorPicker(false);
    setShowBorderPicker(false);
    setShowWatermarkPicker(false);
  };

  const applyMarginPreset = (preset: 'normal' | 'narrow' | 'moderate' | 'wide') => {
    const margins = MARGIN_PRESETS[preset];
    setCustomMargins(margins);
    setPageSettings(prev => ({ ...prev, margins, marginPreset: preset }));
  };

  const applyCustomMargins = () => {
    setPageSettings(prev => ({ ...prev, margins: customMargins, marginPreset: 'custom' }));
    setShowMarginsPicker(false);
  };

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isTableModalOpen) setIsTableModalOpen(false);
        if (isSymbolModalOpen) setIsSymbolModalOpen(false);
        if (isEquationModalOpen) setIsEquationModalOpen(false);
        if (isShortcutsModalOpen) setIsShortcutsModalOpen(false);
        if (isBanglaKeyboardOpen) setIsBanglaKeyboardOpen(false);
        if (isLinkModalOpen) setIsLinkModalOpen(false);
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === '/' || e.key === '?')) {
        e.preventDefault();
        setIsShortcutsModalOpen(prev => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        setIsTableModalOpen(prev => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setViewMode(viewMode === 'pageView' ? 'fluid' : 'pageView');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isTableModalOpen, isSymbolModalOpen, isEquationModalOpen, isShortcutsModalOpen, isBanglaKeyboardOpen, isLinkModalOpen, viewMode, setViewMode]);

  const [openDropdown, setOpenDropdown] = useState<string | null>(null);
  const [isRibbonEnlarged, setIsRibbonEnlarged] = useState(false);

  useEffect(() => {
    if (!openDropdown) return;
    const handleClickOutside = () => setOpenDropdown(null);
    window.addEventListener('click', handleClickOutside);
    return () => window.removeEventListener('click', handleClickOutside);
  }, [openDropdown]);

  const [selectedListStyle, setSelectedListStyle] = useState(BULLET_LIST_OPTIONS[0]);
  const [, setSelectionTick] = useState(0);

  useEffect(() => {
    if (!editor) return;
    const handleUpdate = () => {
      setSelectionTick(prev => prev + 1);
    };
    editor.on('selectionUpdate', handleUpdate);
    editor.on('transaction', handleUpdate);
    return () => {
      editor.off('selectionUpdate', handleUpdate);
      editor.off('transaction', handleUpdate);
    };
  }, [editor]);

  const getCurrentListStyle = () => {
    if (!editor) return selectedListStyle;
    if (editor.isActive('bulletList')) {
      const style = editor.getAttributes('bulletList').style || '';
      if (style.includes('circle')) return BULLET_LIST_OPTIONS[1];
      if (style.includes('square')) return BULLET_LIST_OPTIONS[2];
      return BULLET_LIST_OPTIONS[0];
    }
    if (editor.isActive('orderedList')) {
      const style = editor.getAttributes('orderedList').style || '';
      if (style.includes('bengali')) return BULLET_LIST_OPTIONS[4];
      if (style.includes('upper-roman')) return BULLET_LIST_OPTIONS[5];
      if (style.includes('lower-alpha')) return BULLET_LIST_OPTIONS[6];
      return BULLET_LIST_OPTIONS[3];
    }
    return selectedListStyle;
  };

  const isTableActive = editor ? (editor.isActive('table') || (() => {
    let hasTable = false;
    editor.state.doc.descendants((node: any) => {
      if (node.type.name === 'table') { hasTable = true; return false; }
    });
    return hasTable;
  })()) : false;

  if (!editor) return null;

  const ensureTableFocus = () => {
    if (!editor) return false;
    if (editor.isActive('table')) {
      editor.chain().focus().run();
      return true;
    }
    const selection = editor.state.selection;
    const pos = selection.$from;
    let tablePos: number | null = null;
    for (let d = pos.depth; d > 0; d--) {
      if (pos.node(d).type.name === 'table') {
        tablePos = pos.before(d);
        break;
      }
    }
    if (tablePos !== null) {
      editor.chain().focus().run();
      return true;
    }
    editor.state.doc.descendants((node: any, p: number) => {
      if (node.type.name === 'table' && tablePos === null) {
        tablePos = p;
      }
    });
    if (tablePos !== null) {
      editor.chain().focus().setTextSelection(tablePos + 2).run();
      return true;
    }
    return false;
  };

  const applyTableBorder = (borderStyle: string) => {
    if (!editor) return false;

    // 1. Try updateAttributes on current table selection
    editor.chain().focus().updateAttributes('table', { 'data-border': borderStyle }).run();
    
    // 2. Locate table node at selection depth and update via setNodeMarkup for absolute reliability
    const { selection } = editor.state;
    let tablePos: number | null = null;
    for (let d = selection.$from.depth; d > 0; d--) {
      const node = selection.$from.node(d);
      if (node.type.name === 'table') {
        tablePos = selection.$from.before(d);
        break;
      }
    }

    if (tablePos !== null) {
      const tr = editor.state.tr;
      const tableNode = editor.state.doc.nodeAt(tablePos);
      if (tableNode) {
        tr.setNodeMarkup(tablePos, undefined, {
          ...tableNode.attrs,
          'data-border': borderStyle,
        });
        editor.view.dispatch(tr);
      }
    }

    return true;
  };

  const applyTableStyle = (tableStyle: string) => {
    if (!editor) return false;
    editor.chain().focus().updateAttributes('table', { 'data-table-style': tableStyle }).run();
    const { selection } = editor.state;
    let tablePos: number | null = null;
    for (let d = selection.$from.depth; d > 0; d--) {
      const node = selection.$from.node(d);
      if (node.type.name === 'table') {
        tablePos = selection.$from.before(d);
        break;
      }
    }
    if (tablePos !== null) {
      const tr = editor.state.tr;
      const tableNode = editor.state.doc.nodeAt(tablePos);
      if (tableNode) {
        tr.setNodeMarkup(tablePos, undefined, { ...tableNode.attrs, 'data-table-style': tableStyle });
        editor.view.dispatch(tr);
      }
    }
    return true;
  };

  const applyTableAlign = (align: 'left' | 'center' | 'right') => {
    if (!editor) return false;
    editor.chain().focus().updateAttributes('table', { 'data-align': align }).run();
    const { selection } = editor.state;
    let tablePos: number | null = null;
    for (let d = selection.$from.depth; d > 0; d--) {
      const node = selection.$from.node(d);
      if (node.type.name === 'table') {
        tablePos = selection.$from.before(d);
        break;
      }
    }
    if (tablePos !== null) {
      const tr = editor.state.tr;
      const tableNode = editor.state.doc.nodeAt(tablePos);
      if (tableNode) {
        tr.setNodeMarkup(tablePos, undefined, { ...tableNode.attrs, 'data-align': align });
        editor.view.dispatch(tr);
      }
    }
    return true;
  };

  // Table cells store free-form CSS in a single `style` attribute (row height,
  // shading, vertical alignment). Setting it wholesale would wipe out whatever
  // was there before, so every control merges its own property into the
  // existing declaration list instead of clobbering it.
  const mergeCellStyle = (patch: Record<string, string | null>) => {
    if (!editor) return;
    ensureTableFocus();
    const current: string = editor.getAttributes('tableCell').style || editor.getAttributes('tableHeader').style || '';
    const map = new Map<string, string>();
    current.split(';').forEach(decl => {
      const idx = decl.indexOf(':');
      if (idx === -1) return;
      const prop = decl.slice(0, idx).trim();
      const value = decl.slice(idx + 1).trim();
      if (prop && value) map.set(prop, value);
    });
    Object.entries(patch).forEach(([prop, value]) => {
      if (value === null) map.delete(prop);
      else map.set(prop, value);
    });
    const serialized = Array.from(map.entries()).map(([prop, value]) => `${prop}: ${value};`).join(' ');
    editor.chain().focus().setCellAttribute('style', serialized || null).run();
  };

  const handleSplitTable = () => {
    if (!editor) return false;
    ensureTableFocus();
    const { state, dispatch } = editor.view;
    const { selection } = state;
    const $pos = selection.$from;

    let tableDepth = -1;
    for (let d = $pos.depth; d > 0; d--) {
      if ($pos.node(d).type.name === 'table') {
        tableDepth = d;
        break;
      }
    }

    if (tableDepth === -1) {
      toast.info("Place cursor inside a table cell to split table");
      return false;
    }

    const tableNode = $pos.node(tableDepth);
    const tableStart = $pos.before(tableDepth);
    const tableEnd = $pos.after(tableDepth);

    let currentRowIndex = -1;
    for (let d = $pos.depth; d > tableDepth; d--) {
      if ($pos.node(d).type.name === 'tableRow') {
        currentRowIndex = $pos.index(tableDepth);
        break;
      }
    }

    if (currentRowIndex <= 0) {
      toast.info("Cannot split at row 1. Position cursor on row 2 or lower.");
      return false;
    }

    const topRows: any[] = [];
    const bottomRows: any[] = [];

    tableNode.forEach((child: any, _offset: number, index: number) => {
      if (index < currentRowIndex) {
        topRows.push(child);
      } else {
        bottomRows.push(child);
      }
    });

    if (topRows.length === 0 || bottomRows.length === 0) return false;

    const schema = state.schema;
    const topTable = tableNode.type.create(tableNode.attrs, topRows);
    const bottomTable = tableNode.type.create(tableNode.attrs, bottomRows);
    const emptyParagraph = schema.nodes.paragraph ? schema.nodes.paragraph.create() : schema.text('');

    const tr = state.tr.replaceWith(tableStart, tableEnd, [topTable, emptyParagraph, bottomTable]);
    dispatch(tr);
    toast.success(`Split table into two tables at row ${currentRowIndex + 1}`);
    return true;
  };

  const handleMergeTable = () => {
    if (!editor) return false;
    ensureTableFocus();
    const { state, dispatch } = editor.view;
    const { selection } = state;
    const $pos = selection.$from;

    let tableDepth = -1;
    for (let d = $pos.depth; d > 0; d--) {
      if ($pos.node(d).type.name === 'table') {
        tableDepth = d;
        break;
      }
    }

    if (tableDepth === -1) {
      toast.info("Place cursor inside a table to merge with adjacent table");
      return false;
    }

    const tableStart = $pos.before(tableDepth);
    const tableEnd = $pos.after(tableDepth);
    const doc = state.doc;

    // Search for a table before the current table
    let prevTablePos: number | null = null;
    let prevTableNode: any = null;

    doc.nodesBetween(0, tableStart, (node: any, p: number) => {
      if (node.type.name === 'table' && p < tableStart) {
        prevTablePos = p;
        prevTableNode = node;
      }
    });

    // Check space between prevTable and current table
    if (prevTablePos !== null && prevTableNode !== null) {
      const betweenStart = prevTablePos + prevTableNode.nodeSize;
      const betweenEnd = tableStart;
      let isAdjacent = true;

      doc.nodesBetween(betweenStart, betweenEnd, (n: any) => {
        if (n.type.name === 'table') return;
        if (n.isText && n.text?.trim() !== '') isAdjacent = false;
        if (n.type.name !== 'paragraph' && n.type.name !== 'text') isAdjacent = false;
      });

      if (isAdjacent) {
        const currentTableNode = $pos.node(tableDepth);
        const mergedRows: any[] = [];
        prevTableNode.forEach((child: any) => mergedRows.push(child));
        currentTableNode.forEach((child: any) => mergedRows.push(child));

        const mergedTable = prevTableNode.type.create(prevTableNode.attrs, mergedRows);
        const tr = state.tr.replaceWith(prevTablePos, tableEnd, mergedTable);
        dispatch(tr);
        toast.success("Merged current table with table above");
        return true;
      }
    }

    // Search for a table after the current table
    let nextTablePos: number | null = null;
    let nextTableNode: any = null;

    doc.nodesBetween(tableEnd, doc.content.size, (node: any, p: number) => {
      if (node.type.name === 'table' && p >= tableEnd && nextTablePos === null) {
        nextTablePos = p;
        nextTableNode = node;
      }
    });

    if (nextTablePos !== null && nextTableNode !== null) {
      const betweenStart = tableEnd;
      const betweenEnd = nextTablePos;
      let isAdjacent = true;

      doc.nodesBetween(betweenStart, betweenEnd, (n: any) => {
        if (n.type.name === 'table') return;
        if (n.isText && n.text?.trim() !== '') isAdjacent = false;
        if (n.type.name !== 'paragraph' && n.type.name !== 'text') isAdjacent = false;
      });

      if (isAdjacent) {
        const currentTableNode = $pos.node(tableDepth);
        const mergedRows: any[] = [];
        currentTableNode.forEach((child: any) => mergedRows.push(child));
        nextTableNode.forEach((child: any) => mergedRows.push(child));

        const mergedTable = currentTableNode.type.create(currentTableNode.attrs, mergedRows);
        const tr = state.tr.replaceWith(tableStart, nextTablePos + nextTableNode.nodeSize, mergedTable);
        dispatch(tr);
        toast.success("Merged current table with table below");
        return true;
      }
    }

    toast.info("No adjacent table found immediately above or below to merge with");
    return false;
  };

  const setBulletStyle = (styleType: 'disc' | 'circle' | 'square') => {
    if (!editor) return;
    if (editor.isActive('bulletList')) {
      const currentAttrs = editor.getAttributes('bulletList');
      const currentStyle = currentAttrs?.style || '';
      if (currentStyle.includes(styleType) || (!currentStyle && styleType === 'disc')) {
        editor.chain().focus().toggleBulletList().run();
        toast.info("Bullet list removed");
        return;
      }
      editor.chain().focus().updateAttributes('bulletList', { style: `list-style-type: ${styleType};` }).run();
    } else {
      editor.chain().focus().toggleBulletList().updateAttributes('bulletList', { style: `list-style-type: ${styleType};` }).run();
    }
  };

  const setOrderedStyle = (styleType: 'decimal' | 'bengali' | 'upper-roman' | 'lower-alpha') => {
    if (!editor) return;
    if (editor.isActive('orderedList')) {
      const currentAttrs = editor.getAttributes('orderedList');
      const currentStyle = currentAttrs?.style || '';
      if (currentStyle.includes(styleType) || (!currentStyle && styleType === 'decimal')) {
        editor.chain().focus().toggleOrderedList().run();
        toast.info("Numbered list removed");
        return;
      }
      editor.chain().focus().updateAttributes('orderedList', { style: `list-style-type: ${styleType};` }).run();
    } else {
      editor.chain().focus().toggleOrderedList().updateAttributes('orderedList', { style: `list-style-type: ${styleType};` }).run();
    }
  };

  // isTableActive is already computed above (before the early return)

  const hasTableInDoc = (() => {
    if (!editor) return false;
    let found = false;
    editor.state.doc.descendants((node: any) => {
      if (node.type.name === 'table') found = true;
    });
    return found;
  })();

  const getHeadingValue = () => {
    if (editor.isActive('heading', { level: 1 })) return 'h1';
    if (editor.isActive('heading', { level: 2 })) return 'h2';
    if (editor.isActive('heading', { level: 3 })) return 'h3';
    return 'p';
  };

  const handleHeadingChange = (val: string) => {
    const { empty } = editor.state.selection;
    if (!empty) {
      if (val === 'h1') editor.chain().focus().setFontSize('26px').setBold().run();
      else if (val === 'h2') editor.chain().focus().setFontSize('20px').setBold().run();
      else if (val === 'h3') editor.chain().focus().setFontSize('17px').setBold().run();
      else editor.chain().focus().unsetFontSize().unsetBold().run();
      toast.success("Applied style to highlighted selection");
      return;
    }

    if (val === 'h1') editor.chain().focus().unsetFontSize().toggleHeading({ level: 1 }).run();
    else if (val === 'h2') editor.chain().focus().unsetFontSize().toggleHeading({ level: 2 }).run();
    else if (val === 'h3') editor.chain().focus().unsetFontSize().toggleHeading({ level: 3 }).run();
    else editor.chain().focus().setParagraph().run();
  };

  // Grow Font Size Action
  const handleGrowFont = () => {
    const currentSize = editor.getAttributes('textStyle').fontSize || '14px';
    const num = parseInt(currentSize, 10) || 14;
    const nextStep = FONT_SIZE_STEPS.find(s => parseInt(s, 10) > num) || `${num + 2}px`;
    editor.chain().focus().setFontSize(nextStep).run();
    toast.success(`Font size increased to ${nextStep}`);
  };

  // Shrink Font Size Action
  const handleShrinkFont = () => {
    const currentSize = editor.getAttributes('textStyle').fontSize || '14px';
    const num = parseInt(currentSize, 10) || 14;
    const prevSteps = FONT_SIZE_STEPS.filter(s => parseInt(s, 10) < num);
    const prevStep = prevSteps.length > 0 ? prevSteps[prevSteps.length - 1] : '10px';
    editor.chain().focus().setFontSize(prevStep).run();
    toast.success(`Font size decreased to ${prevStep}`);
  };

  // Cut Action
  const handleCut = () => {
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      toast.info("Select text first to cut");
      return;
    }
    const selectedText = editor.state.doc.textBetween(from, to, ' ');
    navigator.clipboard.writeText(selectedText);
    editor.chain().focus().deleteSelection().run();
    toast.success("Cut text to clipboard");
  };

  // Copy Action
  const handleCopy = () => {
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      toast.info("Select text first to copy");
      return;
    }
    const selectedText = editor.state.doc.textBetween(from, to, ' ');
    navigator.clipboard.writeText(selectedText);
    toast.success("Copied text to clipboard");
  };

  // Paste Action
  const handlePasteAction = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        editor.chain().focus().insertContent(text).run();
        toast.success("Pasted content from clipboard");
      }
    } catch {
      toast.info("Press Ctrl+V to paste content");
    }
  };

  // Format Painter Toggle
  const handleFormatPainter = () => {
    if (formatPainterActive) {
      setFormatPainterActive(false);
      setStoredFormat(null);
      toast.info("Format Painter deactivated");
    } else {
      const activeAttrs = {
        bold: editor.isActive('bold'),
        italic: editor.isActive('italic'),
        underline: editor.isActive('underline'),
        strike: editor.isActive('strike'),
        fontSize: editor.getAttributes('textStyle').fontSize,
        fontFamily: editor.getAttributes('textStyle').fontFamily,
        color: editor.getAttributes('textStyle').color,
        highlight: editor.getAttributes('highlight').color,
      };
      setStoredFormat(activeAttrs);
      setFormatPainterActive(true);
      toast.success("Format Painter active: select text to apply formatting");
    }
  };

  // Sort Lines A-Z Action
  const handleSortLines = () => {
    const { from, to, empty } = editor.state.selection;
    let rawText = '';
    if (!empty) {
      rawText = editor.state.doc.textBetween(from, to, '\n');
    } else {
      rawText = editor.getText();
    }
    const lines = rawText.split('\n').filter(l => l.trim().length > 0);
    if (lines.length <= 1) {
      toast.info("Select multiple lines to sort");
      return;
    }
    lines.sort((a, b) => a.localeCompare(b, 'bn-BD'));
    const sortedText = lines.join('\n');
    if (!empty) {
      editor.chain().focus().insertContentAt({ from, to }, sortedText).run();
    } else {
      editor.commands.setContent(sortedText, { emitUpdate: true });
    }
    toast.success(`Sorted ${lines.length} lines alphabetically (A-Z / ক-ক্ষ)`);
  };

  const handleTextCaseChange = (mode: 'upper' | 'lower' | 'title' | 'sentence' | 'bangla_title') => {
    const { from, to, empty } = editor.state.selection;
    if (empty) {
      toast.info("Select text first to change case or style");
      return;
    }
    const text = editor.state.doc.textBetween(from, to, ' ');
    if (!text) return;

    if (mode === 'bangla_title') {
      editor.chain().focus().setFontSize('20px').setBold().toggleUnderline().run();
      toast.success("Applied Bangla Title Style");
      return;
    }

    let converted = text;
    if (mode === 'upper') converted = text.toUpperCase();
    else if (mode === 'lower') converted = text.toLowerCase();
    else if (mode === 'title') {
      converted = text.replace(/\w\S*/g, (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    } else if (mode === 'sentence') {
      converted = text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    }
    editor.chain().focus().insertContentAt({ from, to }, converted).run();
    toast.success(`Converted text case`);
  };

  const openLinkModal = () => {
    const previousUrl = editor.getAttributes('link').href || '';
    setLinkUrl(previousUrl);
    setIsLinkModalOpen(true);
  };

  const applyLink = () => {
    if (!linkUrl) {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      toast.info("Link removed");
    } else {
      const formattedUrl = linkUrl.startsWith('http://') || linkUrl.startsWith('https://') || linkUrl.startsWith('mailto:')
        ? linkUrl
        : `https://${linkUrl}`;
      editor.chain().focus().extendMarkRange('link').setLink({ href: formattedUrl, target: linkOpenNewTab ? '_blank' : '_self' }).run();
      toast.success("Hyperlink applied");
    }
    setIsLinkModalOpen(false);
  };

  return (
    <div className="bg-card flex flex-col sticky top-0 z-20 w-full select-none">
      {/* RIBBON TAB NAVIGATION BAR (AUTHENTIC WORD 2007 TABS) */}
      <div className="flex items-center justify-between word-ribbon-bg px-3 pt-1 text-xs font-semibold text-muted-foreground overflow-x-auto">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('home')}
            className={`px-4 py-1.5 rounded-t-md transition-all flex items-center gap-1.5 cursor-pointer text-xs ${
              activeTab === 'home'
                ? 'word-ribbon-tab-active font-extrabold'
                : 'hover:text-foreground hover:bg-card/40'
            }`}
          >
            <span>Home</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('insert')}
            className={`px-4 py-1.5 rounded-t-md transition-all flex items-center gap-1.5 cursor-pointer text-xs ${
              activeTab === 'insert'
                ? 'word-ribbon-tab-active font-extrabold'
                : 'hover:text-foreground hover:bg-card/40'
            }`}
          >
            <span>Insert</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('layout')}
            className={`px-4 py-1.5 rounded-t-md transition-all flex items-center gap-1.5 cursor-pointer text-xs ${
              activeTab === 'layout'
                ? 'word-ribbon-tab-active font-extrabold'
                : 'hover:text-foreground hover:bg-card/40'
            }`}
          >
            <span>Page Layout</span>
          </button>

          {/* Contextual Table Tools Tab - Only shown when cursor is clicked inside a table */}
          {isTableActive && (
            <button
              type="button"
              onClick={() => setActiveTab('table')}
              className={`px-4 py-1.5 rounded-t-md transition-all flex items-center gap-1.5 cursor-pointer text-xs relative ${
                activeTab === 'table'
                  ? 'word-ribbon-tab-active font-extrabold'
                  : 'hover:text-foreground hover:bg-card/40 text-emerald-600 dark:text-emerald-400 font-bold'
              }`}
            >
              <Grid className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Table Tools</span>
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" title="Active table cell focused" />
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('tools')}
            className={`px-4 py-1.5 rounded-t-md transition-all flex items-center gap-1.5 cursor-pointer text-xs ${
              activeTab === 'tools'
                ? 'word-ribbon-tab-active font-extrabold'
                : 'hover:text-foreground hover:bg-card/40'
            }`}
          >
            <Languages className="w-3.5 h-3.5 text-primary" />
            <span>Bijoy & Tools</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('view')}
            className={`px-4 py-1.5 rounded-t-md transition-all flex items-center gap-1.5 cursor-pointer text-xs ${
              activeTab === 'view'
                ? 'word-ribbon-tab-active font-extrabold'
                : 'hover:text-foreground hover:bg-card/40'
            }`}
          >
            <Eye className="w-3.5 h-3.5 text-primary" />
            <span>View</span>
          </button>
        </div>

        {/* Quick Search, Window Toggle & Pull-Down Enlarge Header Actions */}
        <div className="flex items-center gap-2 pr-1">
          <button
            type="button"
            onClick={() => setIsRibbonEnlarged(prev => !prev)}
            className={`btn-dynamic px-2.5 py-1 rounded flex items-center gap-1 text-[11px] font-bold cursor-pointer transition-all ${
              isRibbonEnlarged
                ? 'bg-primary/20 text-primary shadow-xs'
                : 'bg-card/80 hover:bg-card text-muted-foreground shadow-2xs'
            }`}
            title={isRibbonEnlarged ? "Restore Standard Ribbon Size" : "Pull Down & Enlarge Ribbon Menu"}
          >
            <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${isRibbonEnlarged ? 'rotate-180 text-primary' : ''}`} />
            <span className="hidden sm:inline">{isRibbonEnlarged ? "Shrink Ribbon" : "Enlarge Ribbon"}</span>
          </button>

          <button
            type="button"
            onClick={() => setIsShortcutsModalOpen(true)}
            className="btn-dynamic px-2.5 py-1 rounded bg-card/80 hover:bg-card text-foreground flex items-center gap-1 text-[11px] font-bold cursor-pointer transition-all shadow-2xs"
            title="Keyboard Shortcuts Guide (Ctrl+/)"
          >
            <Keyboard className="w-3.5 h-3.5 text-primary" />
            <span className="hidden sm:inline">Shortcuts</span>
          </button>

          <button
            type="button"
            onClick={onOpenFindReplace}
            className="btn-dynamic px-2.5 py-1 rounded bg-card/80 hover:bg-card text-foreground flex items-center gap-1 text-[11px] font-bold cursor-pointer transition-all shadow-2xs"
            title="Find & Replace (Ctrl+F)"
          >
            <Search className="w-3.5 h-3.5 text-primary" />
            <span className="hidden sm:inline">Find</span>
          </button>

          <button
            type="button"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className={`btn-dynamic px-2.5 py-1 rounded flex items-center gap-1 text-[11px] font-bold cursor-pointer transition-all ${
              isFullscreen
                ? 'bg-amber-500 text-white hover:bg-amber-600 shadow-sm'
                : 'btn-maroon-gradient shadow-2xs'
            }`}
            title={isFullscreen ? "Exit Fullscreen (Esc / Ctrl+Shift+F)" : "Full Screen Window Mode (Ctrl+Shift+F)"}
          >
            {isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            <span>{isFullscreen ? "Exit Fullscreen" : "Full Screen"}</span>
          </button>
        </div>
      </div>

      {/* RIBBON TOOLBAR BODY (AUTHENTIC MS WORD 2007 RIBBON GROUPS) */}
      <div className={`bg-card flex items-center overflow-x-auto select-none border-b border-border/80 transition-all duration-200 ${
        isRibbonEnlarged ? 'p-3.5 min-h-[135px]' : 'p-2 min-h-[92px]'
      }`}>
        
        {/* ── TAB 1: HOME TAB ── */}
        {activeTab === 'home' && (
          <div className="flex items-stretch gap-2.5 w-full py-0.5 min-h-[82px]">
            
            {/* GROUP 1: CLIPBOARD */}
            <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
              <div className="flex items-center gap-1.5 my-auto">
                {/* Big Paste Button */}
                <button
                  type="button"
                  onClick={handlePasteAction}
                  className="flex flex-col items-center justify-center p-2 rounded hover:bg-muted/80 text-foreground cursor-pointer transition-all border border-transparent hover:border-border"
                  title="Paste (Ctrl+V)"
                >
                  <Clipboard className="w-6 h-6 text-primary" />
                  <span className="text-[10px] font-bold leading-tight mt-0.5">Paste</span>
                </button>

                {/* Stacked Cut, Copy, Format Painter */}
                <div className="flex flex-col gap-0.5 border-l border-border/60 pl-1.5">
                  <button
                    type="button"
                    onClick={handleCut}
                    className="flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-muted text-foreground text-[11px] font-medium cursor-pointer"
                    title="Cut (Ctrl+X)"
                  >
                    <Scissors className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>Cut</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCopy}
                    className="flex items-center gap-1.5 px-2 py-0.5 rounded hover:bg-muted text-foreground text-[11px] font-medium cursor-pointer"
                    title="Copy (Ctrl+C)"
                  >
                    <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                    <span>Copy</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleFormatPainter}
                    className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-medium cursor-pointer transition-colors ${
                      formatPainterActive
                        ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 font-bold border border-amber-500/40'
                        : 'hover:bg-muted text-foreground'
                    }`}
                    title="Format Painter (Copy formatting)"
                  >
                    <Paintbrush className="w-3.5 h-3.5 text-amber-600" />
                    <span>Format Painter</span>
                  </button>
                </div>
              </div>
              <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Clipboard</span>
            </div>

            {/* GROUP 2: FONT */}
            <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
              <div className="flex flex-col gap-1 my-auto">
                {/* Row 1: Font Selector, Size, Grow/Shrink, Case, Clear */}
                <div className="flex items-center gap-1">
                  <div className="w-32">
                    <CustomSelect
                      value={editor.getAttributes('textStyle').fontFamily || ''}
                      onChange={(val) => editor.chain().focus().setFontFamily(val).run()}
                      options={[
                        { value: "", label: "Calibri (Body)" },
                        { value: "Inter, sans-serif", label: "Inter" },
                        { value: "Arial, sans-serif", label: "Arial" },
                        { value: "Times New Roman, serif", label: "Times New Roman" },
                        { value: "Noto Sans Bengali, sans-serif", label: "Bangla (Noto Sans)" },
                        { value: "Kalpurush, sans-serif", label: "Bangla (Kalpurush)" },
                        { value: "SolaimanLipi, sans-serif", label: "Bangla (SolaimanLipi)" },
                        { value: "SutonnyMJ, sans-serif", label: "Bangla (Bijoy Sutonny)" }
                      ]}
                    />
                  </div>

                  <div className="w-16">
                    <CustomSelect
                      value={editor.getAttributes('textStyle').fontSize || ''}
                      onChange={(val) => {
                        if (!val) editor.chain().focus().unsetFontSize().run();
                        else editor.chain().focus().setFontSize(val).run();
                      }}
                      options={[
                        { value: "", label: "Size" },
                        { value: "10px", label: "10" },
                        { value: "11px", label: "11" },
                        { value: "12px", label: "12" },
                        { value: "14px", label: "14" },
                        { value: "16px", label: "16" },
                        { value: "18px", label: "18" },
                        { value: "20px", label: "20" },
                        { value: "24px", label: "24" },
                        { value: "28px", label: "28" },
                        { value: "32px", label: "32" },
                        { value: "36px", label: "36" }
                      ]}
                    />
                  </div>

                  {/* Grow Font & Shrink Font Buttons */}
                  <div className="flex items-center border border-border rounded overflow-hidden">
                    <button
                      type="button"
                      onClick={handleGrowFont}
                      className="px-1.5 py-1 hover:bg-muted text-foreground text-xs font-black cursor-pointer"
                      title="Grow Font (A^)"
                    >
                      A<sup>▲</sup>
                    </button>
                    <button
                      type="button"
                      onClick={handleShrinkFont}
                      className="px-1.5 py-1 hover:bg-muted text-foreground text-xs font-black border-l border-border cursor-pointer"
                      title="Shrink Font (A_)"
                    >
                      A<sub>▼</sub>
                    </button>
                  </div>

                  {/* Change Case Dropdown */}
                  <div className="w-20">
                    <CustomSelect
                      value=""
                      onChange={(val) => {
                        if (val) handleTextCaseChange(val as any);
                      }}
                      options={[
                        { value: "", label: "Aa Case" },
                        { value: "upper", label: "UPPERCASE" },
                        { value: "lower", label: "lowercase" },
                        { value: "title", label: "Title Case" },
                        { value: "sentence", label: "Sentence case" },
                        { value: "bangla_title", label: "Bangla Title" }
                      ]}
                    />
                  </div>

                  {/* Clear Formatting */}
                  <button
                    type="button"
                    onClick={() => editor.chain().focus().unsetAllMarks().clearNodes().run()}
                    className="p-1.5 rounded hover:bg-muted text-amber-600 cursor-pointer"
                    title="Clear All Formatting"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* Row 2: Bold, Italic, Underline, Strike, Sub/Sup, Effects, Highlight, Color */}
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => editor.chain().focus().toggleBold().run()}
                    className={`p-1.5 rounded hover:bg-muted cursor-pointer ${editor.isActive('bold') ? 'bg-primary/20 text-primary font-bold border border-primary/30' : 'text-muted-foreground'}`}
                    title="Bold (Ctrl+B)"
                  >
                    <Bold className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                    className={`p-1.5 rounded hover:bg-muted cursor-pointer ${editor.isActive('italic') ? 'bg-primary/20 text-primary font-bold border border-primary/30' : 'text-muted-foreground'}`}
                    title="Italic (Ctrl+I)"
                  >
                    <Italic className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => editor.chain().focus().toggleUnderline().run()}
                    className={`p-1.5 rounded hover:bg-muted cursor-pointer ${editor.isActive('underline') ? 'bg-primary/20 text-primary font-bold border border-primary/30' : 'text-muted-foreground'}`}
                    title="Underline (Ctrl+U)"
                  >
                    <UnderlineIcon className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => editor.chain().focus().toggleStrike().run()}
                    className={`p-1.5 rounded hover:bg-muted cursor-pointer ${editor.isActive('strike') ? 'bg-primary/20 text-primary font-bold border border-primary/30' : 'text-muted-foreground'}`}
                    title="Strikethrough"
                  >
                    <Strikethrough className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => editor.chain().focus().toggleSubscript().run()}
                    className={`p-1.5 rounded hover:bg-muted cursor-pointer ${editor.isActive('subscript') ? 'bg-primary/20 text-primary font-bold border border-primary/30' : 'text-muted-foreground'}`}
                    title="Subscript (x₂)"
                  >
                    <SubscriptIcon className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => editor.chain().focus().toggleSuperscript().run()}
                    className={`p-1.5 rounded hover:bg-muted cursor-pointer ${editor.isActive('superscript') ? 'bg-primary/20 text-primary font-bold border border-primary/30' : 'text-muted-foreground'}`}
                    title="Superscript (x²)"
                  >
                    <SuperscriptIcon className="w-4 h-4" />
                  </button>

                  <div className="w-px h-4 bg-border/60 mx-1" />

                  {/* Text Highlight Color */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => { setShowHighlightPicker(!showHighlightPicker); setShowColorPicker(false); setShowShadingPicker(false); }}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground flex items-center gap-1 cursor-pointer"
                      title="Text Highlight Color"
                    >
                      <Highlighter className="w-4 h-4 text-amber-500" />
                      <span className="w-2.5 h-2.5 rounded-full border border-border" style={{ backgroundColor: editor.getAttributes('highlight').color || 'transparent' }} />
                    </button>

                    {showHighlightPicker && (
                      <div className="absolute top-full left-0 mt-1 z-[100005] p-2.5 bg-popover border border-border rounded-xl shadow-xl flex flex-col gap-2 w-48">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground">Highlight Color</span>
                        <div className="grid grid-cols-3 gap-1.5">
                          {PRESET_HIGHLIGHT_COLORS.map(c => (
                            <button
                              key={c.label}
                              type="button"
                              onClick={() => {
                                if (!c.color) editor.chain().focus().unsetHighlight().run();
                                else editor.chain().focus().toggleHighlight({ color: c.color }).run();
                                setShowHighlightPicker(false);
                              }}
                              className="p-1.5 rounded-lg border border-border flex items-center justify-center cursor-pointer hover:scale-105 transition-transform text-xs font-bold"
                              style={{ backgroundColor: c.color || '#fff' }}
                              title={c.label}
                            >
                              {c.color ? 'A' : 'None'}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Font Color */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => { setShowColorPicker(!showColorPicker); setShowHighlightPicker(false); setShowShadingPicker(false); }}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground flex items-center gap-1 cursor-pointer"
                      title="Font Color"
                    >
                      <Palette className="w-4 h-4 text-primary" />
                      <span className="w-2.5 h-2.5 rounded-full border border-border" style={{ backgroundColor: editor.getAttributes('textStyle').color || 'currentColor' }} />
                    </button>

                    {showColorPicker && (
                      <div className="absolute top-full left-0 mt-1 z-[100005] p-2.5 bg-popover border border-border rounded-xl shadow-xl flex flex-col gap-2 w-48">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground">Text Color</span>
                        <div className="grid grid-cols-4 gap-1.5">
                          {PRESET_TEXT_COLORS.map(c => (
                            <button
                              key={c.label}
                              type="button"
                              onClick={() => {
                                if (!c.color) editor.chain().focus().unsetColor().run();
                                else editor.chain().focus().setColor(c.color).run();
                                setShowColorPicker(false);
                              }}
                              className="w-8 h-8 rounded-lg border border-border flex items-center justify-center cursor-pointer hover:scale-110 transition-transform"
                              style={{ backgroundColor: c.color || '#fff' }}
                              title={c.label}
                            >
                              {!c.color && <span className="text-xs text-muted-foreground">✖</span>}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Font</span>
            </div>

            {/* GROUP 3: PARAGRAPH */}
            <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
              <div className="flex flex-col gap-1 my-auto">
                {/* Row 1: Bullets, Numbers, Bangla Numbers, Multilevel, Indent, Sort, Show/Hide Marks */}
                <div className="flex items-center gap-1">
                  {/* Dynamic Selected Bullet & List Style Dropdown */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenDropdown(prev => prev === 'bulletStyles' ? null : 'bulletStyles');
                      }}
                      className={`px-2 py-1 rounded hover:bg-muted cursor-pointer flex items-center gap-1.5 border transition-all ${
                        editor.isActive('bulletList') || editor.isActive('orderedList') || openDropdown === 'bulletStyles'
                          ? 'bg-primary/20 text-primary font-bold border-primary/30 shadow-2xs'
                          : 'border-border text-foreground'
                      }`}
                      title="Bullet & Numbered List Options (Click to choose style)"
                    >
                      <span className="font-mono font-bold text-sm text-primary min-w-[16px] text-center">{getCurrentListStyle().prefix}</span>
                      <span className="text-xs font-semibold">{getCurrentListStyle().name.split(' ')[0]}</span>
                      <ChevronDown className="w-3 h-3 text-muted-foreground ml-0.5" />
                    </button>

                    {/* Bullet & Number Style Picker Flyout */}
                    {openDropdown === 'bulletStyles' && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="absolute top-full left-0 mt-1 flex flex-col bg-popover text-popover-foreground border border-border rounded-xl shadow-xl p-2 z-[100005] w-56 animate-in fade-in duration-100"
                      >
                        <span className="text-[10px] uppercase font-bold text-muted-foreground px-2 py-1">Bullet Styles</span>
                        
                        {BULLET_LIST_OPTIONS.slice(0, 3).map(opt => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setSelectedListStyle(opt);
                              setBulletStyle(opt.style as any);
                              toast.success(`Selected ${opt.name}`);
                              setOpenDropdown(null);
                            }}
                            className={`px-2 py-1.5 text-xs text-left rounded hover:bg-muted flex items-center justify-between font-medium cursor-pointer ${
                              getCurrentListStyle().id === opt.id ? 'bg-primary/10 text-primary font-bold' : ''
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <span className="font-mono text-sm font-bold text-primary min-w-[18px] text-center">{opt.prefix}</span>
                              <span>{opt.name}</span>
                            </span>
                            <span className="text-muted-foreground font-mono font-bold">{opt.prefix}</span>
                          </button>
                        ))}

                        <div className="h-px bg-border my-1" />
                        <span className="text-[10px] uppercase font-bold text-muted-foreground px-2 py-1">Numbered & Bangla Styles</span>

                        {BULLET_LIST_OPTIONS.slice(3).map(opt => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setSelectedListStyle(opt);
                              setOrderedStyle(opt.style as any);
                              toast.success(`Selected ${opt.name}`);
                              setOpenDropdown(null);
                            }}
                            className={`px-2 py-1.5 text-xs text-left rounded hover:bg-muted flex items-center justify-between font-medium cursor-pointer ${
                              getCurrentListStyle().id === opt.id ? 'bg-primary/10 text-primary font-bold' : ''
                            }`}
                          >
                            <span className="flex items-center gap-2">
                              <span className="font-mono text-xs font-bold text-primary min-w-[18px] text-center">{opt.prefix}</span>
                              <span>{opt.name}</span>
                            </span>
                            <span className="text-muted-foreground font-mono font-bold">{opt.prefix}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Single Dynamic List Toggle Button (matches selected dropdown style) */}
                  <button
                    type="button"
                    onClick={() => {
                      const curStyle = getCurrentListStyle();
                      if (curStyle.type === 'bullet') {
                        setBulletStyle(curStyle.style as any);
                      } else {
                        setOrderedStyle(curStyle.style as any);
                      }
                    }}
                    className={`px-2 py-1 rounded hover:bg-muted flex items-center justify-center font-extrabold cursor-pointer border transition-all ${
                      editor.isActive('bulletList') || editor.isActive('orderedList')
                        ? 'bg-primary/20 text-primary border-primary/30 font-bold shadow-2xs'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    }`}
                    title={`Toggle List (${getCurrentListStyle().name})`}
                  >
                    <span className="font-mono text-sm font-bold text-primary min-w-[16px] text-center">
                      {getCurrentListStyle().prefix}
                    </span>
                  </button>

                  {/* Bangla Virtual Keyboard Trigger Button */}
                  <button
                    type="button"
                    onClick={() => setIsBanglaKeyboardOpen(true)}
                    className="px-2 py-1 rounded bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 text-xs font-bold cursor-pointer flex items-center gap-1"
                    title="On-Screen Bangla Virtual Keyboard (Click to type Bangla characters)"
                  >
                    <Keyboard className="w-3.5 h-3.5 text-primary" />
                    <span>বাংলা</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => editor.chain().focus().outdent().run()}
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground cursor-pointer"
                    title="Decrease Indent"
                  >
                    <OutdentIcon className="w-4 h-4" />
                  </button>

                  <button
                    type="button"
                    onClick={() => editor.chain().focus().indent().run()}
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground cursor-pointer"
                    title="Increase Indent"
                  >
                    <IndentIcon className="w-4 h-4" />
                  </button>

                  {/* Sort (A-Z) */}
                  <button
                    type="button"
                    onClick={handleSortLines}
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground cursor-pointer"
                    title="Sort Lines Alphabetically (A-Z)"
                  >
                    <ArrowDownAZ className="w-4 h-4 text-primary" />
                  </button>

                  {/* Show/Hide Paragraph Marks (¶) */}
                  <button
                    type="button"
                    onClick={() => {
                      setShowParagraphMarks(!showParagraphMarks);
                      toast.info(`Paragraph marks ${!showParagraphMarks ? 'shown' : 'hidden'}`);
                    }}
                    className={`p-1.5 rounded hover:bg-muted cursor-pointer ${showParagraphMarks ? 'bg-primary/20 text-primary font-bold border border-primary/30' : 'text-muted-foreground'}`}
                    title="Show/Hide Paragraph Marks (¶)"
                  >
                    <Pilcrow className="w-4 h-4" />
                  </button>
                </div>

                {/* Row 2: Alignment, Line Spacing, Shading, Borders */}
                <div className="flex items-center gap-1">
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => editor.chain().focus().setTextAlign('left').run()}
                      className={`p-1.5 rounded hover:bg-muted cursor-pointer ${editor.isActive({ textAlign: 'left' }) ? 'bg-primary/20 text-primary font-bold border border-primary/30' : 'text-muted-foreground'}`}
                      title="Align Left (Ctrl+L)"
                    >
                      <AlignLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => editor.chain().focus().setTextAlign('center').run()}
                      className={`p-1.5 rounded hover:bg-muted cursor-pointer ${editor.isActive({ textAlign: 'center' }) ? 'bg-primary/20 text-primary font-bold border border-primary/30' : 'text-muted-foreground'}`}
                      title="Align Center (Ctrl+E)"
                    >
                      <AlignCenter className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => editor.chain().focus().setTextAlign('right').run()}
                      className={`p-1.5 rounded hover:bg-muted cursor-pointer ${editor.isActive({ textAlign: 'right' }) ? 'bg-primary/20 text-primary font-bold border border-primary/30' : 'text-muted-foreground'}`}
                      title="Align Right (Ctrl+R)"
                    >
                      <AlignRight className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => editor.chain().focus().setTextAlign('justify').run()}
                      className={`p-1.5 rounded hover:bg-muted cursor-pointer ${editor.isActive({ textAlign: 'justify' }) ? 'bg-primary/20 text-primary font-bold border border-primary/30' : 'text-muted-foreground'}`}
                      title="Justify (Ctrl+J)"
                    >
                      <AlignJustify className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="w-20">
                    <CustomSelect
                      value={editor.getAttributes('paragraph').lineHeight || ''}
                      onChange={(val) => {
                        if (!val) editor.chain().focus().unsetLineHeight().run();
                        else editor.chain().focus().setLineHeight(val).run();
                      }}
                      options={[
                        { value: "", label: "Spacing" },
                        { value: "1.0", label: "1.0 Single" },
                        { value: "1.15", label: "1.15 Normal" },
                        { value: "1.5", label: "1.5 Medium" },
                        { value: "2.0", label: "2.0 Double" }
                      ]}
                    />
                  </div>

                  {/* Shading / Background Color */}
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => { setShowShadingPicker(!showShadingPicker); setShowColorPicker(false); setShowHighlightPicker(false); }}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground flex items-center gap-1 cursor-pointer"
                      title="Paragraph Shading (Background Color)"
                    >
                      <PaintBucket className="w-4 h-4 text-emerald-600" />
                    </button>

                    {showShadingPicker && (
                      <div className="absolute top-full left-0 mt-1 z-[100005] p-2.5 bg-popover border border-border rounded-xl shadow-xl flex flex-col gap-2 w-48">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground">Paragraph Shading</span>
                        <div className="grid grid-cols-3 gap-1.5">
                          {PRESET_SHADING_COLORS.map(c => (
                            <button
                              key={c.label}
                              type="button"
                              onClick={() => {
                                if (!c.color) editor.chain().focus().unsetParagraphShading().run();
                                else editor.chain().focus().setParagraphShading(c.color).run();
                                setShowShadingPicker(false);
                              }}
                              className="p-2 rounded-lg border border-border flex items-center justify-center cursor-pointer text-[10px] font-bold truncate"
                              style={{ backgroundColor: c.color || '#fff' }}
                              title={c.label}
                            >
                              {c.color ? 'Fill' : 'None'}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Paragraph</span>
            </div>

            {/* GROUP 4: QUICK STYLES GALLERY */}
            <div className="word-group-box p-1.5 flex flex-col justify-between items-center max-w-[340px]">
              <div className="flex items-center gap-1.5 overflow-x-auto my-auto py-0.5 max-w-[320px]">
                {WORD_QUICK_STYLES.map((styleCard) => (
                  <button
                    key={styleCard.id}
                    type="button"
                    onClick={() => styleCard.action(editor)}
                    className="word-style-card min-w-[70px] h-[52px] px-2 py-1 bg-card rounded border border-border flex flex-col justify-center items-center text-center cursor-pointer select-none"
                    title={`${styleCard.name} - ${styleCard.desc}`}
                  >
                    <span className="text-xs font-bold leading-tight truncate w-full" style={{ color: styleCard.id === 'heading1' || styleCard.id === 'heading2' ? '#800000' : 'inherit' }}>
                      {styleCard.preview}
                    </span>
                    <span className="text-[9px] text-muted-foreground truncate w-full mt-0.5">{styleCard.name}</span>
                  </button>
                ))}
              </div>
              <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Styles</span>
            </div>

            {/* GROUP 5: EDITING */}
            <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
              <div className="flex flex-col gap-1 my-auto">
                <button
                  type="button"
                  onClick={onOpenFindReplace}
                  className="px-2.5 py-1 rounded bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Search className="w-3.5 h-3.5 text-primary" />
                  <span>Find & Replace</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    editor.chain().focus().selectAll().run();
                    toast.success("Selected all document text");
                  }}
                  className="px-2.5 py-1 rounded hover:bg-muted text-muted-foreground text-xs font-medium flex items-center gap-1.5 cursor-pointer"
                >
                  <CheckSquare className="w-3.5 h-3.5 text-blue-500" />
                  <span>Ruler Bar</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsShortcutsModalOpen(true)}
                  className="px-3 py-1.5 rounded bg-muted hover:bg-muted/80 text-foreground flex items-center gap-1.5 text-xs font-semibold border border-border cursor-pointer"
                  title="View Keyboard Shortcuts Guide (Ctrl+/)"
                >
                  <Keyboard className="w-4 h-4 text-primary" />
                  <span>Shortcuts Documentation</span>
                </button>
              </div>
              <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Editing</span>
            </div>

          </div>
        )}

        {/* ── TAB 2: INSERT TAB ── */}
        {activeTab === 'insert' && (
          <div className="flex items-stretch gap-2.5 w-full py-0.5 min-h-[82px]">
            {/* TABLES */}
            <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
              <div className="flex items-center gap-1.5 my-auto">
                <button
                  type="button"
                  onClick={() => setIsTableModalOpen(true)}
                  className="px-3 py-1.5 rounded bg-muted/60 hover:bg-muted text-foreground flex items-center gap-1.5 text-xs font-semibold cursor-pointer border border-border"
                  title="Insert interactive Table Grid (Ctrl+Alt+T)"
                >
                  <Grid className="w-4 h-4 text-primary" />
                  <span>Table Grid</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsTableModalOpen(true)}
                  className="px-3 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 flex items-center gap-1.5 text-xs font-bold cursor-pointer shadow-xs"
                  title="Draw & customize table with specific dimensions and borders (Ctrl+Alt+T)"
                >
                  <TableIcon className="w-4 h-4" />
                  <span>Draw Table</span>
                </button>
              </div>
              <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Tables</span>
            </div>

            {/* PAGES & BREAKS */}
            <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
              <div className="flex items-center gap-1.5 my-auto">
                <button
                  type="button"
                  onClick={() => {
                    editor.chain().focus().insertContent('<hr class="page-break" style="page-break-after: always; border-top: 2px dashed #94a3b8; margin: 24px 0;" />').run();
                    toast.success("Inserted Page Break");
                  }}
                  className="px-3 py-1.5 rounded bg-muted/60 hover:bg-muted text-foreground flex items-center gap-1.5 text-xs font-semibold cursor-pointer border border-border"
                  title="Insert Page Break (Ctrl+Enter)"
                >
                  <SplitSquareVertical className="w-4 h-4 text-primary" />
                  <span>Page Break</span>
                </button>
                <button
                  type="button"
                  onClick={openLinkModal}
                  className="px-3 py-1.5 rounded bg-muted/60 hover:bg-muted text-foreground flex items-center gap-1.5 text-xs font-semibold cursor-pointer border border-border"
                >
                  <LinkIcon className="w-4 h-4 text-primary" />
                  <span>Hyperlink</span>
                </button>
              </div>
              <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Pages & Links</span>
            </div>

            {/* ILLUSTRATIONS & SYMBOLS */}
            <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
              <div className="flex items-center gap-1.5 my-auto">
                <button
                  type="button"
                  onClick={() => {
                    editor.chain().focus().insertContent(`
                      <blockquote style="border-left: 4px solid #800000; background: rgba(128,0,0,0.06); padding: 12px 16px; margin: 12px 0; font-style: normal; border-radius: 0 8px 8px 0;">
                        <strong>📌 Note:</strong> Official notice content...
                      </blockquote>
                    `).run();
                    toast.success("Inserted Callout Box");
                  }}
                  className="px-3 py-1.5 rounded bg-muted/60 hover:bg-muted text-foreground flex items-center gap-1.5 text-xs font-semibold cursor-pointer border border-border"
                >
                  <Info className="w-4 h-4 text-blue-500" />
                  <span>Callout Box</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsEquationModalOpen(true)}
                  className="px-3 py-1.5 rounded bg-muted/60 hover:bg-muted text-foreground flex items-center gap-1.5 text-xs font-semibold cursor-pointer border border-border"
                  title="Insert Mathematical Equations & Formulas"
                >
                  <Sigma className="w-4 h-4 text-primary" />
                  <span>Equation</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsSymbolModalOpen(true)}
                  className="px-3 py-1.5 rounded bg-muted/60 hover:bg-muted text-foreground flex items-center gap-1.5 text-xs font-semibold cursor-pointer border border-border"
                  title="Insert Special Symbols"
                >
                  <Omega className="w-4 h-4 text-primary" />
                  <span>Symbol</span>
                </button>
              </div>
              <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Symbols & Boxes</span>
            </div>
          </div>
        )}

        {/* ── TAB 3: PAGE LAYOUT TAB ── */}
        {activeTab === 'layout' && (
          <div className="flex items-stretch gap-2.5 w-full py-0.5 min-h-[82px]">
            {/* VIEW MODE */}
            <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
              <div className="flex items-center gap-2 my-auto">
                <button
                  type="button"
                  onClick={() => setViewMode('pageView')}
                  className={`px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1.5 border cursor-pointer ${
                    viewMode === 'pageView' ? 'bg-primary text-primary-foreground border-primary shadow-xs' : 'bg-muted hover:bg-muted/80 text-foreground border-border'
                  }`}
                  title="Word A4 Page View (Ctrl+Alt+P)"
                >
                  <FileText className="w-4 h-4" />
                  <span>Word A4 Page</span>
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('fluid')}
                  className={`px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1.5 border cursor-pointer ${
                    viewMode === 'fluid' ? 'bg-primary text-primary-foreground border-primary shadow-xs' : 'bg-muted hover:bg-muted/80 text-foreground border-border'
                  }`}
                  title="Fluid Canvas View (Ctrl+Alt+P)"
                >
                  <Layout className="w-4 h-4" />
                  <span>Fluid Canvas</span>
                </button>
              </div>
              <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">View</span>
            </div>

            {/* PAGE SETUP: Margins, Orientation, Size */}
            <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
              <div className="flex items-center gap-1.5 my-auto">
                {/* Margins */}
                <div className="relative">
                  <button
                    ref={marginsBtnRef}
                    type="button"
                    onClick={() => { const next = !showMarginsPicker; closeLayoutPickers(); setShowMarginsPicker(next); }}
                    className="px-3 py-1.5 rounded bg-muted/60 hover:bg-muted text-foreground flex items-center gap-1.5 text-xs font-semibold cursor-pointer border border-border"
                    title="Page Margins"
                  >
                    <Ruler className="w-4 h-4 text-primary" />
                    <span>Margins</span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  </button>
                  <LayoutPopover open={showMarginsPicker} anchorRef={marginsBtnRef} onClose={() => setShowMarginsPicker(false)} className="w-56">
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">Margin Presets</span>
                    {([
                      { key: 'normal', label: 'Normal', desc: '2.54 cm all sides' },
                      { key: 'narrow', label: 'Narrow', desc: '1.27 cm all sides' },
                      { key: 'moderate', label: 'Moderate', desc: '2.54 / 1.91 cm' },
                      { key: 'wide', label: 'Wide', desc: '2.54 / 5.08 cm' },
                    ] as const).map(p => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => applyMarginPreset(p.key)}
                        className={`px-2 py-1.5 rounded text-left text-xs font-medium cursor-pointer flex items-center justify-between ${
                          pageSettings.marginPreset === p.key ? 'bg-primary/15 text-primary font-bold' : 'hover:bg-muted text-foreground'
                        }`}
                      >
                        <span>{p.label}</span>
                        <span className="text-[10px] text-muted-foreground">{p.desc}</span>
                      </button>
                    ))}
                    <div className="border-t border-border pt-1.5 mt-1 flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold uppercase text-muted-foreground">Custom (mm)</span>
                      <div className="grid grid-cols-2 gap-1.5">
                        {([['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right']] as const).map(([key, label]) => (
                          <label key={key} className="flex items-center gap-1 text-[10px] text-muted-foreground">
                            {label}
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={customMargins[key]}
                              onChange={(e) => setCustomMargins(prev => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }))}
                              className="w-14 px-1 py-0.5 rounded border border-border bg-background text-foreground text-xs"
                            />
                          </label>
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={applyCustomMargins}
                        className="px-2 py-1 rounded bg-primary text-primary-foreground text-xs font-bold cursor-pointer"
                      >
                        Apply Custom Margins
                      </button>
                    </div>
                  </LayoutPopover>
                </div>

                {/* Orientation */}
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => setPageSettings(prev => ({ ...prev, orientation: 'portrait' }))}
                    className={`p-1.5 rounded cursor-pointer border ${pageSettings.orientation === 'portrait' ? 'bg-primary/20 text-primary border-primary/30 font-bold' : 'text-muted-foreground border-transparent hover:bg-muted'}`}
                    title="Portrait Orientation"
                  >
                    <RectangleVertical className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPageSettings(prev => ({ ...prev, orientation: 'landscape' }))}
                    className={`p-1.5 rounded cursor-pointer border ${pageSettings.orientation === 'landscape' ? 'bg-primary/20 text-primary border-primary/30 font-bold' : 'text-muted-foreground border-transparent hover:bg-muted'}`}
                    title="Landscape Orientation"
                  >
                    <RectangleHorizontal className="w-4 h-4" />
                  </button>
                </div>

                {/* Size */}
                <div className="relative">
                  <button
                    ref={sizeBtnRef}
                    type="button"
                    onClick={() => { const next = !showSizePicker; closeLayoutPickers(); setShowSizePicker(next); }}
                    className="px-3 py-1.5 rounded bg-muted/60 hover:bg-muted text-foreground flex items-center gap-1.5 text-xs font-semibold cursor-pointer border border-border"
                    title="Page Size"
                  >
                    <Maximize2 className="w-4 h-4 text-primary" />
                    <span>{pageSettings.size}</span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  </button>
                  <LayoutPopover open={showSizePicker} anchorRef={sizeBtnRef} onClose={() => setShowSizePicker(false)} className="w-44 gap-0.5">
                    {(Object.keys(PAGE_SIZES_MM) as PageSize[]).map(size => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => { setPageSettings(prev => ({ ...prev, size })); setShowSizePicker(false); }}
                        className={`px-2 py-1.5 rounded text-left text-xs font-medium cursor-pointer flex items-center justify-between ${
                          pageSettings.size === size ? 'bg-primary/15 text-primary font-bold' : 'hover:bg-muted text-foreground'
                        }`}
                      >
                        <span>{size}</span>
                        <span className="text-[10px] text-muted-foreground">{PAGE_SIZES_MM[size][0]}×{PAGE_SIZES_MM[size][1]} mm</span>
                      </button>
                    ))}
                  </LayoutPopover>
                </div>
              </div>
              <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Page Setup</span>
            </div>

            {/* COLUMNS & BREAKS */}
            <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
              <div className="flex items-center gap-1.5 my-auto">
                <div className="relative">
                  <button
                    ref={columnsBtnRef}
                    type="button"
                    onClick={() => { const next = !showColumnsPicker; closeLayoutPickers(); setShowColumnsPicker(next); }}
                    className="px-3 py-1.5 rounded bg-muted/60 hover:bg-muted text-foreground flex items-center gap-1.5 text-xs font-semibold cursor-pointer border border-border"
                    title="Insert Multi-Column Layout"
                  >
                    <Columns className="w-4 h-4 text-primary" />
                    <span>Columns</span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  </button>
                  <LayoutPopover open={showColumnsPicker} anchorRef={columnsBtnRef} onClose={() => setShowColumnsPicker(false)} className="w-40 gap-0.5">
                    <button
                      type="button"
                      onClick={() => { editor.chain().focus().insertColumnGroup(2).run(); setShowColumnsPicker(false); }}
                      className="px-2 py-1.5 rounded text-left text-xs font-medium cursor-pointer hover:bg-muted text-foreground"
                    >
                      Two Columns
                    </button>
                    <button
                      type="button"
                      onClick={() => { editor.chain().focus().insertColumnGroup(3).run(); setShowColumnsPicker(false); }}
                      className="px-2 py-1.5 rounded text-left text-xs font-medium cursor-pointer hover:bg-muted text-foreground"
                    >
                      Three Columns
                    </button>
                  </LayoutPopover>
                </div>

                <div className="relative">
                  <button
                    ref={breaksBtnRef}
                    type="button"
                    onClick={() => { const next = !showBreaksPicker; closeLayoutPickers(); setShowBreaksPicker(next); }}
                    className="px-3 py-1.5 rounded bg-muted/60 hover:bg-muted text-foreground flex items-center gap-1.5 text-xs font-semibold cursor-pointer border border-border"
                    title="Insert Page or Column Break"
                  >
                    <SplitSquareVertical className="w-4 h-4 text-primary" />
                    <span>Breaks</span>
                    <ChevronDown className="w-3 h-3 text-muted-foreground" />
                  </button>
                  <LayoutPopover open={showBreaksPicker} anchorRef={breaksBtnRef} onClose={() => setShowBreaksPicker(false)} className="w-44 gap-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        editor.chain().focus().insertContent('<hr class="page-break" style="page-break-after: always; border-top: 2px dashed #94a3b8; margin: 24px 0;" />').run();
                        toast.success("Inserted Page Break");
                        setShowBreaksPicker(false);
                      }}
                      className="px-2 py-1.5 rounded text-left text-xs font-medium cursor-pointer hover:bg-muted text-foreground"
                    >
                      Page Break
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        editor.chain().focus().insertColumnBreak().run();
                        toast.success("Inserted Column Break");
                        setShowBreaksPicker(false);
                      }}
                      className="px-2 py-1.5 rounded text-left text-xs font-medium cursor-pointer hover:bg-muted text-foreground"
                    >
                      Column Break
                    </button>
                  </LayoutPopover>
                </div>
              </div>
              <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Columns & Breaks</span>
            </div>

            {/* PAGE BACKGROUND: Watermark, Page Color, Page Borders */}
            <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
              <div className="flex items-center gap-1.5 my-auto">
                {/* Watermark */}
                <div className="relative">
                  <button
                    ref={watermarkBtnRef}
                    type="button"
                    onClick={() => { const next = !showWatermarkPicker; closeLayoutPickers(); setShowWatermarkPicker(next); }}
                    className={`px-3 py-1.5 rounded flex items-center gap-1.5 text-xs font-semibold cursor-pointer border ${
                      pageSettings.watermark.enabled ? 'bg-primary/15 text-primary border-primary/30' : 'bg-muted/60 hover:bg-muted text-foreground border-border'
                    }`}
                    title="Watermark"
                  >
                    <Droplets className="w-4 h-4 text-primary" />
                    <span>Watermark</span>
                  </button>
                  <LayoutPopover open={showWatermarkPicker} anchorRef={watermarkBtnRef} onClose={() => setShowWatermarkPicker(false)} className="w-56 gap-2">
                    <label className="flex items-center gap-2 text-xs font-semibold text-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={pageSettings.watermark.enabled}
                        onChange={(e) => setPageSettings(prev => ({ ...prev, watermark: { ...prev.watermark, enabled: e.target.checked } }))}
                      />
                      Show Watermark
                    </label>
                    <input
                      type="text"
                      value={pageSettings.watermark.text}
                      onChange={(e) => setPageSettings(prev => ({ ...prev, watermark: { ...prev.watermark, text: e.target.value } }))}
                      placeholder="Watermark text"
                      className="px-2 py-1 rounded border border-border bg-background text-foreground text-xs"
                    />
                    <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      Color
                      <input
                        type="color"
                        value={pageSettings.watermark.color}
                        onChange={(e) => setPageSettings(prev => ({ ...prev, watermark: { ...prev.watermark, color: e.target.value } }))}
                        className="w-7 h-6 rounded border border-border cursor-pointer"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      Opacity
                      <input
                        type="range"
                        min={0.05}
                        max={0.6}
                        step={0.05}
                        value={pageSettings.watermark.opacity}
                        onChange={(e) => setPageSettings(prev => ({ ...prev, watermark: { ...prev.watermark, opacity: parseFloat(e.target.value) } }))}
                        className="flex-1 cursor-pointer"
                      />
                    </label>
                  </LayoutPopover>
                </div>

                {/* Page Color */}
                <div className="relative">
                  <button
                    ref={pageColorBtnRef}
                    type="button"
                    onClick={() => { const next = !showPageColorPicker; closeLayoutPickers(); setShowPageColorPicker(next); }}
                    className="p-1.5 rounded hover:bg-muted text-muted-foreground flex items-center gap-1 cursor-pointer"
                    title="Page Color"
                  >
                    <Palette className="w-4 h-4 text-amber-600" />
                  </button>
                  <LayoutPopover open={showPageColorPicker} anchorRef={pageColorBtnRef} onClose={() => setShowPageColorPicker(false)} className="w-48 gap-2">
                    <span className="text-[10px] font-bold uppercase text-muted-foreground">Page Color</span>
                    <div className="grid grid-cols-3 gap-1.5">
                      {PRESET_PAGE_COLORS.map(c => (
                        <button
                          key={c.label}
                          type="button"
                          onClick={() => { setPageSettings(prev => ({ ...prev, pageColor: c.color })); setShowPageColorPicker(false); }}
                          className="p-2 rounded-lg border border-border flex items-center justify-center cursor-pointer text-[10px] font-bold truncate"
                          style={{ backgroundColor: c.color || '#fff' }}
                          title={c.label}
                        >
                          {c.color ? '' : 'None'}
                        </button>
                      ))}
                    </div>
                  </LayoutPopover>
                </div>

                {/* Page Borders */}
                <div className="relative">
                  <button
                    ref={borderBtnRef}
                    type="button"
                    onClick={() => { const next = !showBorderPicker; closeLayoutPickers(); setShowBorderPicker(next); }}
                    className={`px-3 py-1.5 rounded flex items-center gap-1.5 text-xs font-semibold cursor-pointer border ${
                      pageSettings.border.enabled ? 'bg-primary/15 text-primary border-primary/30' : 'bg-muted/60 hover:bg-muted text-foreground border-border'
                    }`}
                    title="Page Borders"
                  >
                    <BorderIcon className="w-4 h-4 text-primary" />
                    <span>Borders</span>
                  </button>
                  <LayoutPopover open={showBorderPicker} anchorRef={borderBtnRef} onClose={() => setShowBorderPicker(false)} className="w-52 gap-2">
                    <label className="flex items-center gap-2 text-xs font-semibold text-foreground cursor-pointer">
                      <input
                        type="checkbox"
                        checked={pageSettings.border.enabled}
                        onChange={(e) => setPageSettings(prev => ({ ...prev, border: { ...prev.border, enabled: e.target.checked } }))}
                      />
                      Show Page Border
                    </label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {(['solid', 'double', 'dashed', 'dotted'] as const).map(style => (
                        <button
                          key={style}
                          type="button"
                          onClick={() => setPageSettings(prev => ({ ...prev, border: { ...prev.border, style } }))}
                          className={`px-2 py-1 rounded text-[10px] font-medium capitalize cursor-pointer border ${
                            pageSettings.border.style === style ? 'bg-primary/15 text-primary border-primary/30' : 'hover:bg-muted text-foreground border-border'
                          }`}
                        >
                          {style}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      Width (pt)
                      <input
                        type="number"
                        min={1}
                        max={12}
                        value={pageSettings.border.width}
                        onChange={(e) => setPageSettings(prev => ({ ...prev, border: { ...prev.border, width: parseFloat(e.target.value) || 1 } }))}
                        className="w-14 px-1 py-0.5 rounded border border-border bg-background text-foreground text-xs"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      Color
                      <input
                        type="color"
                        value={pageSettings.border.color}
                        onChange={(e) => setPageSettings(prev => ({ ...prev, border: { ...prev.border, color: e.target.value } }))}
                        className="w-7 h-6 rounded border border-border cursor-pointer"
                      />
                    </label>
                  </LayoutPopover>
                </div>
              </div>
              <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Page Background</span>
            </div>
          </div>
        )}

        {/* ── TAB 4: TABLE TOOLS ── */}
        {activeTab === 'table' && (
          <div className="flex items-stretch gap-2.5 w-full py-0.5 min-h-[82px]">
            {!isTableActive ? (
              <div className="text-xs text-muted-foreground italic flex items-center gap-2 my-auto">
                <span>Place cursor inside a table cell to manage columns, rows, borders, and orientation.</span>
                <button
                  type="button"
                  onClick={() => setIsTableModalOpen(true)}
                  className="px-3 py-1 rounded bg-primary text-primary-foreground font-bold text-xs not-italic cursor-pointer hover:bg-primary/90"
                >
                  Insert Table Grid
                </button>
              </div>
            ) : (
              <>
                <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
                  <div className="flex items-center gap-1 my-auto">
                    <button type="button" onClick={() => { ensureTableFocus(); editor.chain().focus().addColumnBefore().run(); }} className="px-2 py-1 rounded bg-muted hover:bg-muted/80 text-foreground text-xs font-medium cursor-pointer">+Col Left</button>
                    <button type="button" onClick={() => { ensureTableFocus(); editor.chain().focus().addColumnAfter().run(); }} className="px-2 py-1 rounded bg-muted hover:bg-muted/80 text-foreground text-xs font-medium cursor-pointer">+Col Right</button>
                    <button type="button" onClick={() => { ensureTableFocus(); editor.chain().focus().deleteColumn().run(); }} className="px-2 py-1 rounded bg-destructive/10 hover:bg-destructive/20 text-destructive text-xs font-medium cursor-pointer">Del Col</button>
                  </div>
                  <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Columns</span>
                </div>

                <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
                  <div className="flex items-center gap-1 my-auto">
                    <button type="button" onClick={() => { ensureTableFocus(); editor.chain().focus().addRowBefore().run(); }} className="px-2 py-1 rounded bg-muted hover:bg-muted/80 text-foreground text-xs font-medium cursor-pointer">+Row Above</button>
                    <button type="button" onClick={() => { ensureTableFocus(); editor.chain().focus().addRowAfter().run(); }} className="px-2 py-1 rounded bg-muted hover:bg-muted/80 text-foreground text-xs font-medium cursor-pointer">+Row Below</button>
                    <button type="button" onClick={() => { ensureTableFocus(); editor.chain().focus().deleteRow().run(); }} className="px-2 py-1 rounded bg-destructive/10 hover:bg-destructive/20 text-destructive text-xs font-medium cursor-pointer">Del Row</button>
                    <button type="button" onClick={() => { ensureTableFocus(); editor.chain().focus().deleteTable().run(); }} className="px-2 py-1 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 text-xs font-semibold cursor-pointer">Del Table</button>
                  </div>
                  <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Rows & Table</span>
                </div>

                {/* ROW HEIGHT & RESIZING */}
                <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
                  <div className="flex items-center gap-1 my-auto">
                    <button
                      type="button"
                      onClick={() => {
                        mergeCellStyle({ height: '30px' });
                        toast.success("Row Height: Compact (30px)");
                      }}
                      className="px-2 py-1 rounded bg-muted hover:bg-muted/80 text-foreground text-xs font-medium cursor-pointer"
                      title="Set Row Height to Compact (30px)"
                    >
                      Compact
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        mergeCellStyle({ height: '50px' });
                        toast.success("Row Height: Medium (50px)");
                      }}
                      className="px-2 py-1 rounded bg-muted hover:bg-muted/80 text-foreground text-xs font-medium cursor-pointer"
                      title="Set Row Height to Medium (50px)"
                    >
                      Medium
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        mergeCellStyle({ height: '80px' });
                        toast.success("Row Height: Tall (80px)");
                      }}
                      className="px-2 py-1 rounded bg-muted hover:bg-muted/80 text-foreground text-xs font-medium cursor-pointer"
                      title="Set Row Height to Tall (80px)"
                    >
                      Tall
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        mergeCellStyle({ height: null });
                        toast.info("Reset Row Height to Auto");
                      }}
                      className="px-1.5 py-1 rounded bg-muted/60 text-muted-foreground text-xs cursor-pointer"
                      title="Reset Row Height to Default Auto"
                    >
                      Auto
                    </button>
                  </div>
                  <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Row Height</span>
                </div>

                {/* CELL SHADING */}
                <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
                  <div className="relative my-auto">
                    <button
                      ref={cellShadingBtnRef}
                      type="button"
                      onClick={() => { const next = openDropdown === 'cellShading' ? null : 'cellShading'; setOpenDropdown(next); }}
                      className="px-2.5 py-1 rounded bg-muted hover:bg-muted/80 text-foreground text-xs font-bold flex items-center gap-1.5 cursor-pointer border border-border"
                      title="Cell Shading (Background Color)"
                    >
                      <PaintBucket className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Shading</span>
                      <ChevronDown className="w-3 h-3 text-muted-foreground" />
                    </button>
                    <LayoutPopover open={openDropdown === 'cellShading'} anchorRef={cellShadingBtnRef} onClose={() => setOpenDropdown(null)} className="w-48">
                      <span className="text-[10px] font-bold uppercase text-muted-foreground">Cell Shading</span>
                      <div className="grid grid-cols-3 gap-1.5">
                        {PRESET_SHADING_COLORS.map(c => (
                          <button
                            key={c.label}
                            type="button"
                            onClick={() => {
                              mergeCellStyle({ 'background-color': c.color || null });
                              toast.success(c.color ? `Applied ${c.label}` : "Removed cell shading");
                              setOpenDropdown(null);
                            }}
                            className="p-2 rounded-lg border border-border flex items-center justify-center cursor-pointer text-[10px] font-bold truncate"
                            style={{ backgroundColor: c.color || '#fff' }}
                            title={c.label}
                          >
                            {c.color ? '' : 'None'}
                          </button>
                        ))}
                      </div>
                    </LayoutPopover>
                  </div>
                  <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Shading</span>
                </div>

                {/* VERTICAL ALIGNMENT */}
                <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
                  <div className="flex items-center gap-0.5 my-auto">
                    <button
                      type="button"
                      onClick={() => { mergeCellStyle({ 'vertical-align': 'top' }); toast.success("Cell text aligned to top"); }}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground cursor-pointer"
                      title="Align Cell Text to Top"
                    >
                      <AlignVerticalJustifyStart className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => { mergeCellStyle({ 'vertical-align': 'middle' }); toast.success("Cell text aligned to middle"); }}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground cursor-pointer"
                      title="Align Cell Text to Middle"
                    >
                      <AlignVerticalJustifyCenter className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => { mergeCellStyle({ 'vertical-align': 'bottom' }); toast.success("Cell text aligned to bottom"); }}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground cursor-pointer"
                      title="Align Cell Text to Bottom"
                    >
                      <AlignVerticalJustifyEnd className="w-4 h-4" />
                    </button>
                  </div>
                  <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Vertical Align</span>
                </div>

                {/* MERGE & SPLIT CELLS & TABLES */}
                <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
                  <div className="flex items-center gap-1 my-auto">
                    <button
                      type="button"
                      onClick={() => {
                        ensureTableFocus();
                        if (editor.can().mergeCells()) {
                          editor.chain().focus().mergeCells().run();
                          toast.success("Merged selected cells");
                        } else {
                          toast.info("Highlight/select multiple cells first to merge");
                        }
                      }}
                      className={`px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 cursor-pointer border border-border ${
                        editor.can().mergeCells() ? 'bg-primary text-primary-foreground font-bold shadow-xs' : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                      title="Merge selected table cells into a single cell"
                    >
                      <Combine className="w-3.5 h-3.5" />
                      <span>Merge Cells</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        ensureTableFocus();
                        if (editor.can().splitCell()) {
                          editor.chain().focus().splitCell().run();
                          toast.success("Split merged cell into individual cells");
                        } else {
                          editor.chain().focus().addColumnAfter().run();
                          toast.success("Divided cell into two by adding a column");
                        }
                      }}
                      className="px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 cursor-pointer border border-border bg-muted hover:bg-muted/80 text-foreground"
                      title="Divide or split current table cell into two"
                    >
                      <Split className="w-3.5 h-3.5 text-primary" />
                      <span>Split Cell</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleSplitTable}
                      className="px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 cursor-pointer border border-border bg-muted hover:bg-muted/80 text-foreground"
                      title="Split table into two separate tables at current cursor row"
                    >
                      <SplitSquareVertical className="w-3.5 h-3.5 text-amber-500" />
                      <span>Split Table</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleMergeTable}
                      className="px-2 py-1 rounded text-xs font-semibold flex items-center gap-1 cursor-pointer border border-border bg-muted hover:bg-muted/80 text-foreground"
                      title="Merge current table with adjacent table immediately above or below"
                    >
                      <Combine className="w-3.5 h-3.5 text-indigo-500" />
                      <span>Merge Tables</span>
                    </button>
                  </div>
                  <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Merge & Split</span>
                </div>

                {/* ORIENTATION */}
                <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
                  <button
                    type="button"
                    onClick={() => {
                      ensureTableFocus();
                      const cellAttrs = editor.getAttributes('tableCell') || {};
                      const headerAttrs = editor.getAttributes('tableHeader') || {};
                      const currentDir = cellAttrs['data-text-direction'] || headerAttrs['data-text-direction'] || 'horizontal';
                      const nextDir = currentDir === 'vertical-rl' ? 'horizontal' : 'vertical-rl';
                      editor.chain().focus().setCellAttribute('data-text-direction', nextDir).run();
                      toast.success(`Cell rotation: ${nextDir === 'vertical-rl' ? 'Vertical 90°' : 'Horizontal'}`);
                    }}
                    className="my-auto px-2.5 py-1 rounded bg-muted text-foreground text-xs font-bold flex items-center gap-1.5 cursor-pointer border border-border"
                  >
                    <RotateCw className="w-3.5 h-3.5 text-primary" />
                    <span>Rotate Text (90°)</span>
                  </button>
                  <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Orientation</span>
                </div>

                {/* LISTS IN TABLE CELLS */}
                <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
                  <div className="flex items-center gap-1 my-auto">
                    {/* Dynamic Selected Bullet & List Dropdown inside Table Tools */}
                    <div className="relative">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpenDropdown(prev => prev === 'tableBulletStyles' ? null : 'tableBulletStyles');
                        }}
                        className={`px-2 py-1 rounded hover:bg-muted cursor-pointer flex items-center gap-1.5 border transition-all ${
                          editor.isActive('bulletList') || editor.isActive('orderedList') || openDropdown === 'tableBulletStyles'
                            ? 'bg-primary/20 text-primary font-bold border-primary/30 shadow-2xs'
                            : 'border-border text-foreground'
                        }`}
                        title="Cell List Library (Select bullet or number style)"
                      >
                        <span className="font-mono font-bold text-sm text-primary min-w-[16px] text-center">{getCurrentListStyle().prefix}</span>
                        <span className="text-xs font-semibold">{getCurrentListStyle().name.split(' ')[0]}</span>
                        <ChevronDown className="w-3 h-3 text-muted-foreground ml-0.5" />
                      </button>

                      {openDropdown === 'tableBulletStyles' && (
                        <div
                          onClick={(e) => e.stopPropagation()}
                          className="absolute top-full left-0 mt-1 flex flex-col bg-popover text-popover-foreground border border-border rounded-xl shadow-xl p-2 z-[100005] w-56 animate-in fade-in duration-100"
                        >
                          <span className="text-[10px] uppercase font-bold text-muted-foreground px-2 py-1">Bullet Styles</span>
                          
                          {BULLET_LIST_OPTIONS.slice(0, 3).map(opt => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => {
                                ensureTableFocus();
                                setSelectedListStyle(opt);
                                setBulletStyle(opt.style as any);
                                toast.success(`Applied ${opt.name} to cell`);
                                setOpenDropdown(null);
                              }}
                              className={`px-2 py-1.5 text-xs text-left rounded hover:bg-muted flex items-center justify-between font-medium cursor-pointer ${
                                getCurrentListStyle().id === opt.id ? 'bg-primary/10 text-primary font-bold' : ''
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                <span className="font-mono text-sm font-bold text-primary min-w-[18px] text-center">{opt.prefix}</span>
                                <span>{opt.name}</span>
                              </span>
                              <span className="text-muted-foreground font-mono font-bold">{opt.prefix}</span>
                            </button>
                          ))}

                          <div className="h-px bg-border my-1" />
                          <span className="text-[10px] uppercase font-bold text-muted-foreground px-2 py-1">Numbered & Bangla Styles</span>

                          {BULLET_LIST_OPTIONS.slice(3).map(opt => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => {
                                ensureTableFocus();
                                setSelectedListStyle(opt);
                                setOrderedStyle(opt.style as any);
                                toast.success(`Applied ${opt.name} to cell`);
                                setOpenDropdown(null);
                              }}
                              className={`px-2 py-1.5 text-xs text-left rounded hover:bg-muted flex items-center justify-between font-medium cursor-pointer ${
                                getCurrentListStyle().id === opt.id ? 'bg-primary/10 text-primary font-bold' : ''
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold text-primary min-w-[18px] text-center">{opt.prefix}</span>
                                <span>{opt.name}</span>
                              </span>
                              <span className="text-muted-foreground font-mono font-bold">{opt.prefix}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Cell Lists</span>
                </div>

                {/* TABLE BORDER STYLE DROPDOWN */}
                <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
                  <div className="relative my-auto">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenDropdown(prev => prev === 'tableBorders' ? null : 'tableBorders');
                      }}
                      className={`px-2.5 py-1 rounded text-xs font-bold flex items-center gap-1.5 cursor-pointer border border-border ${
                        openDropdown === 'tableBorders' ? 'bg-primary text-primary-foreground shadow-xs' : 'bg-muted hover:bg-muted/80 text-foreground'
                      }`}
                      title="Set Table Border Style (Click to open)"
                    >
                      <Grid className="w-3.5 h-3.5" />
                      <span>Table Borders</span>
                      <ChevronDown className="w-3 h-3 text-muted-foreground" />
                    </button>

                    {openDropdown === 'tableBorders' && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="absolute top-full left-0 mt-1 flex flex-col bg-popover text-popover-foreground border border-border rounded-xl shadow-xl p-2 z-[100005] w-48 animate-in fade-in duration-100"
                      >
                        <span className="text-[10px] uppercase font-bold text-muted-foreground px-2 py-1">Table Border Options</span>

                        <button
                          type="button"
                          onClick={() => {
                            applyTableBorder('full');
                            toast.success("All Grid Borders Enabled");
                            setOpenDropdown(null);
                          }}
                          className="px-2 py-1.5 text-xs text-left rounded hover:bg-muted flex items-center justify-between font-medium cursor-pointer"
                        >
                          <span>田 All Grid Borders</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            applyTableBorder('outer');
                            toast.success("Outer Box Border Only Enabled");
                            setOpenDropdown(null);
                          }}
                          className="px-2 py-1.5 text-xs text-left rounded hover:bg-muted flex items-center justify-between font-medium cursor-pointer"
                        >
                          <span>▢ Outer Box Border</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            applyTableBorder('header');
                            toast.success("Header Row Border Only Enabled");
                            setOpenDropdown(null);
                          }}
                          className="px-2 py-1.5 text-xs text-left rounded hover:bg-muted flex items-center justify-between font-medium cursor-pointer"
                        >
                          <span>▔ Header Row Border</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            applyTableBorder('dashed');
                            toast.success("Dashed Grid Lines Enabled");
                            setOpenDropdown(null);
                          }}
                          className="px-2 py-1.5 text-xs text-left rounded hover:bg-muted flex items-center justify-between font-medium cursor-pointer"
                        >
                          <span>╍ Dashed Grid Lines</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            applyTableBorder('thick');
                            toast.success("Thick Solid Border Enabled");
                            setOpenDropdown(null);
                          }}
                          className="px-2 py-1.5 text-xs text-left rounded hover:bg-muted flex items-center justify-between font-medium cursor-pointer"
                        >
                          <span>⬛ Heavy Thick Border</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            applyTableBorder('none');
                            toast.info("Invisible No-Border Mode Enabled");
                            setOpenDropdown(null);
                          }}
                          className="px-2 py-1.5 text-xs text-left rounded hover:bg-muted flex items-center justify-between font-medium cursor-pointer text-muted-foreground"
                        >
                          <span>🚫 No Borders (Invisible)</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Borders</span>
                </div>

                {/* TABLE STYLE GALLERY */}
                <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
                  <div className="flex items-center gap-1.5 my-auto">
                    {([
                      { id: 'none', label: 'Plain', swatch: '#ffffff', header: undefined },
                      { id: 'grid-blue', label: 'Blue Grid', swatch: '#dbeafe', header: '#1e3a8a' },
                      { id: 'bands-gray', label: 'Gray Bands', swatch: '#e5e7eb', header: '#374151' },
                      { id: 'crimson-header', label: 'Crimson', swatch: '#fdf2f2', header: '#800000' },
                    ] as const).map(s => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => { applyTableStyle(s.id); toast.success(`Applied ${s.label} table style`); }}
                        className="flex flex-col items-center gap-0.5 cursor-pointer group"
                        title={s.label}
                      >
                        <span
                          className="w-8 h-6 rounded border border-border overflow-hidden flex flex-col group-hover:ring-2 group-hover:ring-primary/40"
                          style={{ backgroundColor: s.swatch }}
                        >
                          <span className="h-2 w-full" style={{ backgroundColor: s.header || '#cbd5e1' }} />
                        </span>
                        <span className="text-[8px] text-muted-foreground font-semibold">{s.label}</span>
                      </button>
                    ))}
                  </div>
                  <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Table Styles</span>
                </div>

                {/* TABLE ALIGNMENT ON PAGE */}
                <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
                  <div className="flex items-center gap-0.5 my-auto">
                    <button
                      type="button"
                      onClick={() => { applyTableAlign('left'); toast.success("Table aligned left"); }}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground cursor-pointer"
                      title="Align Table Left"
                    >
                      <AlignLeft className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => { applyTableAlign('center'); toast.success("Table centered"); }}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground cursor-pointer"
                      title="Center Table on Page"
                    >
                      <AlignCenter className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => { applyTableAlign('right'); toast.success("Table aligned right"); }}
                      className="p-1.5 rounded hover:bg-muted text-muted-foreground cursor-pointer"
                      title="Align Table Right"
                    >
                      <AlignRight className="w-4 h-4" />
                    </button>
                  </div>
                  <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Table Align</span>
                </div>

                {/* DRAW TABLE */}
                <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
                  <button
                    type="button"
                    onClick={() => setIsTableModalOpen(true)}
                    className="my-auto px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
                    title="Draw or Insert a Custom Table with specified dimensions and borders"
                  >
                    <Grid className="w-3.5 h-3.5" />
                    <span>Draw Table</span>
                  </button>
                  <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Table Grid</span>
                </div>

                {/* DELETE TABLE */}
                <div className="word-group-box p-1.5 flex flex-col justify-between items-center border-l border-destructive/30 pl-2">
                  <button
                    type="button"
                    onClick={() => {
                      editor.chain().focus().deleteTable().run();
                      toast.success("Deleted entire table");
                    }}
                    className="my-auto px-3 py-1.5 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs"
                    title="Delete Entire Table"
                  >
                    <Trash2 className="w-4 h-4" />
                    <span>Delete Table</span>
                  </button>
                  <span className="text-[9px] font-bold text-destructive tracking-wider uppercase mt-auto">Table Removal</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── TAB 5: BIJOY & TOOLS ── */}
        {activeTab === 'tools' && (
          <div className="flex items-stretch gap-2.5 w-full py-0.5 min-h-[82px]">
            <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
              <div className="flex items-center gap-2 my-auto">
                <button
                  type="button"
                  onClick={() => {
                    const { from, to, empty } = editor.state.selection;
                    if (!empty) {
                      const selectedText = editor.state.doc.textBetween(from, to, ' ');
                      if (selectedText) {
                        const converted = convertBijoyToUnicode(selectedText);
                        editor.chain().focus().insertContentAt({ from, to }, converted).run();
                        toast.success("Converted Bijoy ➔ Unicode");
                      }
                    } else {
                      const htmlContent = editor.getHTML();
                      const convertedHtml = convertHtmlBijoyToUnicode(htmlContent);
                      editor.commands.setContent(convertedHtml, { emitUpdate: true });
                      toast.success("Converted Document Bijoy ➔ Unicode");
                    }
                  }}
                  className="px-3.5 py-1.5 rounded bg-primary/10 text-primary flex items-center gap-1.5 text-xs font-bold border border-primary/30 hover:bg-primary/20 transition-all cursor-pointer"
                >
                  <Languages className="w-4 h-4" />
                  <span>SutonnyMJ (Bijoy 52) ➔ Unicode Bangla</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const banglaDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
                    const { from, to, empty } = editor.state.selection;
                    if (!empty) {
                      const text = editor.state.doc.textBetween(from, to, ' ');
                      const converted = text.replace(/[0-9]/g, (d: string) => banglaDigits[parseInt(d, 10)]);
                      editor.chain().focus().insertContentAt({ from, to }, converted).run();
                      toast.success("Converted Digits (123 ➔ ১২৩)");
                    } else {
                      const html = editor.getHTML();
                      const converted = html.replace(/[0-9]/g, (d: string) => banglaDigits[parseInt(d, 10)]);
                      editor.commands.setContent(converted, { emitUpdate: true });
                      toast.success("Converted Document Digits (123 ➔ ১২৩)");
                    }
                  }}
                  className="px-3 py-1.5 rounded bg-muted hover:bg-muted/80 text-foreground flex items-center gap-1.5 text-xs font-semibold border border-border cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                  <span>Digits (123 ➔ ১২৩)</span>
                </button>
              </div>
              <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Bangla Conversion</span>
            </div>

            {/* GROUP 3: HELP & SHORTCUTS */}
            <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
              <button
                type="button"
                onClick={() => setIsShortcutsModalOpen(true)}
                className="px-3.5 py-1.5 rounded bg-primary/10 text-primary flex items-center gap-1.5 text-xs font-bold border border-primary/30 hover:bg-primary/20 transition-all cursor-pointer my-auto"
                title="View Keyboard Shortcuts Guide (Ctrl+/)"
              >
                <Keyboard className="w-4 h-4 text-primary" />
                <span>Keyboard Shortcuts</span>
              </button>
              <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Help & Info</span>
            </div>
          </div>
        )}

        {/* ── TAB 6: VIEW TAB ── */}
        {activeTab === 'view' && (
          <div className="flex items-stretch gap-2.5 w-full py-0.5 min-h-[82px]">
            <div className="word-group-box p-1.5 flex flex-col justify-between items-center">
              <div className="flex items-center gap-2 my-auto">
                <button
                  type="button"
                  onClick={() => setShowRuler(!showRuler)}
                  className={`px-3 py-1.5 rounded text-xs font-bold flex items-center gap-1.5 border cursor-pointer ${
                    showRuler ? 'bg-primary/20 text-primary border-primary' : 'bg-muted text-muted-foreground border-border'
                  }`}
                >
                  <Ruler className="w-4 h-4" />
                  <span>Ruler Bar</span>
                </button>

                <button
                  type="button"
                  onClick={() => setZoomLevel(100)}
                  className="px-3 py-1.5 rounded bg-muted hover:bg-muted/80 text-foreground text-xs font-bold border border-border cursor-pointer"
                >
                  100% Zoom
                </button>
              </div>
              <span className="text-[9px] font-bold text-muted-foreground/80 tracking-wider uppercase mt-auto">Document Views</span>
            </div>
          </div>
        )}

      </div>

      {/* INTERACTIVE PULL-DOWN HANDLE TO ENLARGE OR RESTORE MENU RIBBON HEIGHT */}
      <div className="w-full flex justify-center bg-muted/40 border-b border-border/60 py-0.5 relative group">
        <button
          type="button"
          onClick={() => setIsRibbonEnlarged(prev => !prev)}
          className="px-6 py-0.5 rounded-b-md bg-card hover:bg-primary/10 text-muted-foreground hover:text-primary border border-t-0 border-border text-[10px] font-bold flex items-center gap-1.5 cursor-pointer transition-all shadow-2xs group-hover:border-primary/40"
          title={isRibbonEnlarged ? "Click / Pull Up to Restore Standard Ribbon Size" : "Pull Down to Enlarge Ribbon Toolbar (Spacious Mode)"}
        >
          <div className="w-3 h-0.5 rounded-full bg-muted-foreground/40 group-hover:bg-primary" />
          <ChevronDown className={`w-3 h-3 transition-transform duration-200 text-primary ${isRibbonEnlarged ? 'rotate-180' : ''}`} />
          <span>{isRibbonEnlarged ? "Pull Up Ribbon" : "Pull Down to Enlarge Ribbon"}</span>
          <div className="w-3 h-0.5 rounded-full bg-muted-foreground/40 group-hover:bg-primary" />
        </button>
      </div>

      {/* MODAL PORTAL 1: HYPERLINK MODAL */}
      {mounted && isLinkModalOpen && createPortal(
        <div 
          className="fixed inset-0 z-[100010] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() => setIsLinkModalOpen(false)}
        >
          <div 
            className="bg-popover text-popover-foreground border border-border rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden select-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2">
                <LinkIcon className="w-4 h-4 text-primary" />
                <h3 className="text-sm font-bold">Hyperlink Manager</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsLinkModalOpen(false)}
                className="p-1 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 flex flex-col gap-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1">Target URL:</label>
                <input
                  type="text"
                  placeholder="https://example.com or mailto:info@buet.ac.bd"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="openNewTab"
                  checked={linkOpenNewTab}
                  onChange={(e) => setLinkOpenNewTab(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary cursor-pointer"
                />
                <label htmlFor="openNewTab" className="text-xs font-medium text-foreground cursor-pointer">
                  Open link in new browser tab (`target="_blank"`)
                </label>
              </div>
            </div>

            <div className="px-5 py-3 border-t border-border bg-muted/20 flex items-center justify-between">
              {editor.isActive('link') ? (
                <button
                  type="button"
                  onClick={() => {
                    editor.chain().focus().extendMarkRange('link').unsetLink().run();
                    setIsLinkModalOpen(false);
                    toast.info("Hyperlink removed");
                  }}
                  className="px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/10 rounded-lg flex items-center gap-1.5 cursor-pointer"
                >
                  <Unlink className="w-3.5 h-3.5" />
                  <span>Remove Link</span>
                </button>
              ) : <div />}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsLinkModalOpen(false)}
                  className="px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted rounded-lg cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={applyLink}
                  className="px-4 py-1.5 text-xs font-bold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 cursor-pointer shadow-xs"
                >
                  Apply Link
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL PORTAL 2: TABLE SELECTION MODAL */}
      {mounted && isTableModalOpen && createPortal(
        <div 
          className="fixed inset-0 z-[100010] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() => setIsTableModalOpen(false)}
        >
          <div 
            className="bg-popover text-popover-foreground border border-border rounded-2xl shadow-2xl w-full max-w-lg flex flex-col overflow-hidden select-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <TableIcon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold">Insert Table Grid</h3>
                  <p className="text-xs text-muted-foreground">Select table grid size and border formatting</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsTableModalOpen(false)}
                className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 flex flex-col gap-5">
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <span className="text-xs font-bold uppercase text-muted-foreground tracking-wider">
                    Grid Size Picker
                  </span>
                  <span className="text-xs font-bold px-3 py-1 rounded-lg bg-primary/10 text-primary border border-primary/20">
                    {hoverRows > 0 && hoverCols > 0
                      ? `${hoverRows} × ${hoverCols} Table`
                      : `${customRows} × ${customCols} Selected`}
                  </span>
                </div>

                <div 
                  className="flex flex-col gap-1.5 p-3 bg-muted/40 rounded-xl border border-border/60 items-center justify-center"
                  onMouseLeave={() => { setHoverRows(0); setHoverCols(0); }}
                >
                  {Array.from({ length: 10 }).map((_, r) => (
                    <div key={r} className="flex gap-1.5">
                      {Array.from({ length: 10 }).map((_, c) => {
                        const isHighlighted = r < (hoverRows || customRows) && c < (hoverCols || customCols);
                        return (
                          <button
                            key={c}
                            type="button"
                            onMouseDown={(e) => e.preventDefault()}
                            onMouseEnter={() => {
                              setHoverRows(r + 1);
                              setHoverCols(c + 1);
                            }}
                            onClick={() => {
                              const rows = r + 1;
                              const cols = c + 1;
                              setCustomRows(rows);
                              setCustomCols(cols);
                              editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).updateAttributes('table', { 'data-border': tableBorderOption }).run();
                              setIsTableModalOpen(false);
                              toast.success(`Inserted ${rows}×${cols} table`);
                            }}
                            className={`w-7 h-7 rounded-md border transition-all cursor-pointer transform hover:scale-105 ${
                              isHighlighted
                                ? "bg-primary text-primary-foreground border-primary shadow-2xs font-bold"
                                : "bg-background border-border/80 hover:border-muted-foreground"
                            }`}
                            title={`${r + 1} × ${c + 1} Table`}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-4 border-t border-border bg-muted/20 flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={() => setIsTableModalOpen(false)}
                className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold rounded-xl cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  editor.chain().focus().insertTable({ rows: customRows, cols: customCols, withHeaderRow: true }).updateAttributes('table', { 'data-border': tableBorderOption }).run();
                  setIsTableModalOpen(false);
                  toast.success(`Inserted ${customRows}×${customCols} table`);
                }}
                className="px-5 py-2 rounded-xl bg-primary text-primary-foreground font-bold text-xs hover:bg-primary/90 transition-all shadow-md cursor-pointer flex items-center gap-2"
              >
                <TableIcon className="w-4 h-4" />
                <span>Insert Table</span>
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL PORTAL 3: SYMBOL PICKER MODAL */}
      {mounted && isSymbolModalOpen && createPortal(
        <div 
          className="fixed inset-0 z-[100010] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() => setIsSymbolModalOpen(false)}
        >
          <div 
            className="bg-popover text-popover-foreground border border-border rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[88vh] overflow-hidden select-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Omega className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold">Special Symbols Picker</h3>
                  <p className="text-xs text-muted-foreground">Click any symbol to insert directly into document</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSymbolModalOpen(false)}
                className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-3 border-b border-border/60 bg-card flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="relative w-full sm:w-72">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search symbols..."
                    value={symbolSearch}
                    onChange={(e) => setSymbolSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-background/50">
              {SYMBOL_CATEGORIES.map((cat) => {
                if (selectedCategory !== "All" && cat.name !== selectedCategory && !symbolSearch) return null;

                const filteredSymbols = cat.symbols.filter(sym =>
                  !symbolSearch || sym.includes(symbolSearch) || cat.name.toLowerCase().includes(symbolSearch.toLowerCase())
                );

                if (filteredSymbols.length === 0) return null;

                return (
                  <div key={cat.name}>
                    <h4 className="text-xs uppercase font-bold text-muted-foreground tracking-wider mb-3 flex items-center gap-2">
                      <span>{cat.name}</span>
                      <div className="flex-1 h-px bg-border/60" />
                    </h4>
                    <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-2.5">
                      {filteredSymbols.map((sym) => (
                        <button
                          key={sym}
                          type="button"
                          onClick={() => {
                            editor.chain().focus().insertContent(sym).run();
                            toast.success(`Inserted symbol: ${sym}`);
                          }}
                          className="h-12 w-12 rounded-xl bg-card hover:bg-primary hover:text-primary-foreground border border-border text-xl font-bold flex items-center justify-center shadow-2xs transition-all transform hover:scale-110 cursor-pointer"
                        >
                          {sym}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-6 py-3 border-t border-border bg-muted/20 flex justify-end">
              <button
                type="button"
                onClick={() => setIsSymbolModalOpen(false)}
                className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold rounded-lg cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL PORTAL 4: EQUATION PICKER MODAL */}
      {mounted && isEquationModalOpen && createPortal(
        <div 
          className="fixed inset-0 z-[100010] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() => setIsEquationModalOpen(false)}
        >
          <div 
            className="bg-popover text-popover-foreground border border-border rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col max-h-[88vh] overflow-hidden select-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Sigma className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold">Insert Mathematical Equation</h3>
                  <p className="text-xs text-muted-foreground">Select a formula preset or type a custom math expression</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEquationModalOpen(false)}
                className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Search & Custom Input */}
            <div className="px-6 py-3 border-b border-border/60 bg-card flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="relative w-full sm:w-72">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search equations..."
                    value={equationSearch}
                    onChange={(e) => setEquationSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>

                {/* Quick Insert Custom Equation */}
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <input
                    type="text"
                    placeholder="Custom equation (e.g. E = mc²)..."
                    value={customEquationInput}
                    onChange={(e) => setCustomEquationInput(e.target.value)}
                    className="px-3 py-1.5 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary flex-1 sm:w-64"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!customEquationInput.trim()) return;
                      editor.chain().focus().insertContent(`<span class="math-equation font-mono bg-muted/40 px-2.5 py-1 rounded border border-border inline-block">${customEquationInput}</span> `).run();
                      toast.success("Inserted custom equation");
                      setCustomEquationInput('');
                      setIsEquationModalOpen(false);
                    }}
                    className="px-3.5 py-1.5 text-xs font-bold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 cursor-pointer shadow-2xs whitespace-nowrap"
                  >
                    Insert Custom
                  </button>
                </div>
              </div>
            </div>

            {/* Equation Presets Grid */}
            <div className="p-6 overflow-y-auto space-y-4 flex-1 bg-background/50">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {EQUATION_PRESETS.filter(eq => 
                  !equationSearch || 
                  eq.name.toLowerCase().includes(equationSearch.toLowerCase()) || 
                  eq.formula.toLowerCase().includes(equationSearch.toLowerCase()) ||
                  eq.category.toLowerCase().includes(equationSearch.toLowerCase())
                ).map((eq) => (
                  <div
                    key={eq.name}
                    onClick={() => {
                      editor.chain().focus().insertContent(`${eq.html} `).run();
                      toast.success(`Inserted ${eq.name}`);
                      setIsEquationModalOpen(false);
                    }}
                    className="p-4 rounded-xl bg-card hover:bg-muted/60 border border-border hover:border-primary/50 transition-all cursor-pointer flex flex-col justify-between gap-3 group shadow-2xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-foreground group-hover:text-primary transition-colors">{eq.name}</span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-md bg-primary/10 text-primary border border-primary/20">{eq.category}</span>
                    </div>
                    <div className="p-3 bg-muted/40 rounded-lg border border-border/80 flex items-center justify-center font-mono text-sm overflow-x-auto" dangerouslySetInnerHTML={{ __html: eq.html }} />
                  </div>
                ))}
              </div>
            </div>

            <div className="px-6 py-3 border-t border-border bg-muted/20 flex justify-end">
              <button
                type="button"
                onClick={() => setIsEquationModalOpen(false)}
                className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold rounded-lg cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL PORTAL 5: KEYBOARD SHORTCUTS GUIDE MODAL */}
      {mounted && isShortcutsModalOpen && createPortal(
        <div 
          className="fixed inset-0 z-[100010] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() => setIsShortcutsModalOpen(false)}
        >
          <div 
            className="bg-popover text-popover-foreground border border-border rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col max-h-[88vh] overflow-hidden select-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-primary/10 text-primary">
                  <Keyboard className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold">Keyboard Shortcuts Documentation</h3>
                  <p className="text-xs text-muted-foreground">Quick reference for MS Word ribbon & editor keyboard shortcuts</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsShortcutsModalOpen(false)}
                className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search Input */}
            <div className="px-6 py-3 border-b border-border/60 bg-card">
              <div className="relative w-full">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search shortcuts (e.g. indent, bold, align, copy, find)..."
                  value={shortcutsSearch}
                  onChange={(e) => setShortcutsSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            {/* Shortcuts List Grid */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1 bg-background/50">
              {KEYBOARD_SHORTCUTS_DATA.map((cat) => {
                const filtered = cat.shortcuts.filter(s =>
                  !shortcutsSearch ||
                  s.key.toLowerCase().includes(shortcutsSearch.toLowerCase()) ||
                  s.desc.toLowerCase().includes(shortcutsSearch.toLowerCase()) ||
                  cat.category.toLowerCase().includes(shortcutsSearch.toLowerCase())
                );
                if (filtered.length === 0) return null;

                return (
                  <div key={cat.category}>
                    <h4 className="text-xs uppercase font-bold text-muted-foreground tracking-wider mb-3 flex items-center gap-2">
                      <span>{cat.category}</span>
                      <div className="flex-1 h-px bg-border/60" />
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                      {filtered.map((item) => (
                        <div
                          key={item.key + item.desc}
                          className="p-3 rounded-xl bg-card border border-border flex items-center justify-between gap-3 shadow-2xs"
                        >
                          <span className="text-xs text-foreground font-medium">{item.desc}</span>
                          <kbd className="px-2.5 py-1 text-[11px] font-mono font-bold bg-muted/80 text-primary rounded-md border border-border/80 shadow-2xs whitespace-nowrap">
                            {item.key}
                          </kbd>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="px-6 py-3 border-t border-border bg-muted/20 flex justify-end">
              <button
                type="button"
                onClick={() => setIsShortcutsModalOpen(false)}
                className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold rounded-lg cursor-pointer"
              >
                Close (Esc)
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* MODAL PORTAL 6: BANGLA VIRTUAL KEYBOARD MODAL */}
      {mounted && isBanglaKeyboardOpen && createPortal(
        <div 
          className="fixed inset-0 z-[100010] flex items-center justify-center bg-black/75 backdrop-blur-xs p-4 animate-in fade-in duration-150"
          onClick={() => setIsBanglaKeyboardOpen(false)}
        >
          <div 
            className="bg-popover text-popover-foreground border border-border rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] overflow-hidden select-none"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-border bg-muted/30">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-primary/10 text-primary font-bold text-lg">
                  বাংলা
                </div>
                <div>
                  <h3 className="text-base font-bold">Bangla On-Screen Virtual Keyboard</h3>
                  <p className="text-xs text-muted-foreground">Click any character or phrase to insert into your document</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsBanglaKeyboardOpen(false)}
                className="p-2 text-muted-foreground hover:text-foreground rounded-lg hover:bg-muted cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-5 flex-1 bg-background/50">
              {/* Vowels */}
              <div>
                <h4 className="text-xs uppercase font-bold text-muted-foreground tracking-wider mb-2">স্বরাক্ষর (Vowels)</h4>
                <div className="flex flex-wrap gap-2">
                  {BANGLA_KEYBOARD_DATA.vowels.map(char => (
                    <button
                      key={char}
                      type="button"
                      onClick={() => {
                        editor.chain().focus().insertContent(char).run();
                        toast.success(`Inserted: ${char}`);
                      }}
                      className="w-10 h-10 rounded-xl bg-card hover:bg-primary hover:text-primary-foreground border border-border text-lg font-bold flex items-center justify-center shadow-2xs transition-all cursor-pointer"
                    >
                      {char}
                    </button>
                  ))}
                </div>
              </div>

              {/* Matras & Signs */}
              <div>
                <h4 className="text-xs uppercase font-bold text-muted-foreground tracking-wider mb-2">কার ও চিহ্নাদী (Matras & Symbols)</h4>
                <div className="flex flex-wrap gap-2">
                  {BANGLA_KEYBOARD_DATA.matras.map(char => (
                    <button
                      key={char}
                      type="button"
                      onClick={() => {
                        editor.chain().focus().insertContent(char).run();
                        toast.success(`Inserted: ${char}`);
                      }}
                      className="w-10 h-10 rounded-xl bg-card hover:bg-primary hover:text-primary-foreground border border-border text-lg font-bold flex items-center justify-center shadow-2xs transition-all cursor-pointer"
                    >
                      {char}
                    </button>
                  ))}
                </div>
              </div>

              {/* Consonants */}
              <div>
                <h4 className="text-xs uppercase font-bold text-muted-foreground tracking-wider mb-2">ব্যঞ্জনবর্ণ (Consonants)</h4>
                <div className="grid grid-cols-7 sm:grid-cols-10 gap-2">
                  {BANGLA_KEYBOARD_DATA.consonants.map(char => (
                    <button
                      key={char}
                      type="button"
                      onClick={() => {
                        editor.chain().focus().insertContent(char).run();
                        toast.success(`Inserted: ${char}`);
                      }}
                      className="w-10 h-10 rounded-xl bg-card hover:bg-primary hover:text-primary-foreground border border-border text-lg font-bold flex items-center justify-center shadow-2xs transition-all cursor-pointer"
                    >
                      {char}
                    </button>
                  ))}
                </div>
              </div>

              {/* Digits & Numbers */}
              <div>
                <h4 className="text-xs uppercase font-bold text-muted-foreground tracking-wider mb-2">সংখ্যা (Digits)</h4>
                <div className="flex flex-wrap gap-2">
                  {BANGLA_KEYBOARD_DATA.digits.map(char => (
                    <button
                      key={char}
                      type="button"
                      onClick={() => {
                        editor.chain().focus().insertContent(char).run();
                        toast.success(`Inserted: ${char}`);
                      }}
                      className="w-10 h-10 rounded-xl bg-card hover:bg-primary hover:text-primary-foreground border border-border text-lg font-bold flex items-center justify-center shadow-2xs transition-all cursor-pointer"
                    >
                      {char}
                    </button>
                  ))}
                </div>
              </div>

              {/* Quick List Bullet Prefixes & Phrases */}
              <div>
                <h4 className="text-xs uppercase font-bold text-muted-foreground tracking-wider mb-2">তালিকা ও বাক্য খণ্ড (List Prefixes & Phrases)</h4>
                <div className="flex flex-wrap gap-2">
                  {BANGLA_KEYBOARD_DATA.quickPhrases.map(phrase => (
                    <button
                      key={phrase}
                      type="button"
                      onClick={() => {
                        editor.chain().focus().insertContent(`${phrase} `).run();
                        toast.success(`Inserted: ${phrase}`);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-card hover:bg-primary hover:text-primary-foreground border border-border text-xs font-bold shadow-2xs transition-all cursor-pointer"
                    >
                      {phrase}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-3 border-t border-border bg-muted/20 flex justify-end">
              <button
                type="button"
                onClick={() => setIsBanglaKeyboardOpen(false)}
                className="px-4 py-2 bg-muted hover:bg-muted/80 text-foreground text-xs font-semibold rounded-lg cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

// FIND & REPLACE DRAWER COMPONENT
const FindReplaceDrawer = ({ 
  isOpen, 
  onClose, 
  editor 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  editor: any; 
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [replaceTerm, setReplaceTerm] = useState('');
  const [matchCount, setMatchCount] = useState(0);

  useEffect(() => {
    if (!editor || !searchTerm) {
      setMatchCount(0);
      return;
    }
    const html = editor.getHTML() || '';
    const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const matches = html.match(regex);
    setMatchCount(matches ? matches.length : 0);
  }, [searchTerm, editor]);

  if (!isOpen || !editor) return null;

  const handleReplace = () => {
    if (!searchTerm) return;
    const content = editor.getHTML();
    const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (regex.test(content)) {
      const updated = content.replace(regex, replaceTerm);
      editor.commands.setContent(updated, { emitUpdate: true });
      toast.success(`Replaced match`);
    } else {
      toast.info("No match found");
    }
  };

  const handleReplaceAll = () => {
    if (!searchTerm) return;
    const content = editor.getHTML();
    const regex = new RegExp(searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    const updated = content.replace(regex, replaceTerm);
    editor.commands.setContent(updated, { emitUpdate: true });
    toast.success(`Replaced all occurrences`);
  };

  return (
    <div className="bg-card border-b border-border p-3 flex flex-wrap items-center gap-3 animate-in slide-in-from-top-2 duration-150 shadow-md">
      <div className="flex items-center gap-1.5 text-xs font-bold text-primary">
        <Search className="w-4 h-4" />
        <span>Find & Replace:</span>
      </div>

      <div className="flex items-center gap-2 flex-1 min-w-[200px]">
        <input
          type="text"
          placeholder="Find text..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="px-3 py-1.5 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary flex-1"
        />
        <input
          type="text"
          placeholder="Replace with..."
          value={replaceTerm}
          onChange={(e) => setReplaceTerm(e.target.value)}
          className="px-3 py-1.5 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-2 focus:ring-primary flex-1"
        />
      </div>

      {searchTerm && (
        <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-muted text-muted-foreground border border-border">
          {matchCount} match{matchCount !== 1 ? 'es' : ''}
        </span>
      )}

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={handleReplace}
          className="px-3 py-1.5 text-xs font-semibold bg-muted hover:bg-muted/80 rounded-lg cursor-pointer border border-border"
        >
          Replace
        </button>
        <button
          type="button"
          onClick={handleReplaceAll}
          className="px-3 py-1.5 text-xs font-bold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 cursor-pointer shadow-2xs"
        >
          Replace All
        </button>
        <button
          type="button"
          onClick={onClose}
          className="p-1.5 hover:bg-muted text-muted-foreground rounded-lg cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

// MS WORD TOP RULER COMPONENT
const WordRuler = ({ viewMode, pageWidthMm, marginLeftMm, marginRightMm }: { viewMode: 'fluid' | 'pageView'; pageWidthMm: number; marginLeftMm: number; marginRightMm: number }) => {
  const tickCount = viewMode === 'fluid' ? 25 : Math.round(pageWidthMm / 12.5);
  const totalWidthStyle = viewMode === 'pageView' ? { maxWidth: `${pageWidthMm}mm` } : undefined;
  const paddingClass = viewMode === 'pageView' ? "" : "px-6 md:px-12";
  const paddingStyle = viewMode === 'pageView' ? { paddingLeft: `${marginLeftMm}mm`, paddingRight: `${marginRightMm}mm` } : undefined;

  return (
    <div className="word-ruler h-7 w-full flex items-center border-b text-[9px] font-bold text-muted-foreground select-none relative overflow-hidden transition-all bg-muted/40">
      <div className={`w-full ${viewMode === 'pageView' ? 'mx-auto' : ''} flex items-center justify-between ${paddingClass} relative h-full`} style={{ ...totalWidthStyle, ...paddingStyle }}>
        <div className="w-full flex justify-between items-center">
          {Array.from({ length: tickCount }).map((_, i) => (
            <div key={i} className="flex flex-col items-center relative">
              <span className="text-[8px] leading-none mb-0.5 font-mono">{i}</span>
              <div className="w-px h-2 bg-muted-foreground/50" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default function RichTextEditor({
  content,
  onChange,
  className = "p-4 min-h-[300px]",
  editable = true,
  onSave
}: {
  content: string;
  onChange: (html: string) => void;
  className?: string;
  editable?: boolean;
  /** Invoked when the user presses Ctrl/Cmd+S while the editor has focus. */
  onSave?: () => void;
}) {
  // Keep the latest onSave in a ref so the editor's keydown handler (created once)
  // always calls the current callback without re-instantiating the editor.
  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; }, [onSave]);
  const [viewMode, setViewMode] = useState<'fluid' | 'pageView'>('fluid');
  const [zoomLevel, setZoomLevel] = useState<number>(100);
  const [isFindReplaceOpen, setIsFindReplaceOpen] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showParagraphMarks, setShowParagraphMarks] = useState(false);
  const [showRuler, setShowRuler] = useState(true);
  const [pageSettings, setPageSettings] = useState<PageSettings>(DEFAULT_PAGE_SETTINGS);

  const [rawPageW, rawPageH] = PAGE_SIZES_MM[pageSettings.size];
  const pageWidthMm = pageSettings.orientation === 'landscape' ? rawPageH : rawPageW;
  const pageHeightMm = pageSettings.orientation === 'landscape' ? rawPageW : rawPageH;

  useEffect(() => {
    const handleFullscreenKeys = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setIsFullscreen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleFullscreenKeys);
    return () => window.removeEventListener('keydown', handleFullscreenKeys);
  }, [isFullscreen]);

  // Ctrl/Cmd+S triggers the host's save handler even when focus has moved to the
  // toolbar or a nearby field. The editor's own keydown handler covers the
  // in-content case; this covers the rest of the editing panel.
  useEffect(() => {
    if (!editable) return;
    const handleSaveKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 's') {
        if (onSaveRef.current) {
          e.preventDefault();
          onSaveRef.current();
        }
      }
    };
    window.addEventListener('keydown', handleSaveKey);
    return () => window.removeEventListener('keydown', handleSaveKey);
  }, [editable]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        orderedList: false,
        bulletList: false,
        horizontalRule: false,
      }),
      CustomOrderedList,
      CustomBulletList,
      CustomHorizontalRule,
      ColumnSection,
      ColumnBreak,
      ColumnItem,
      ColumnGroup,
      Underline,
      TextStyle,
      FontFamily,
      FontSize,
      LineHeight,
      ParagraphShading,
      Indent,
      Color,
      Highlight.configure({ multicolor: true }),
      Subscript,
      Superscript,
      CharacterCount,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: {
          class: 'text-primary underline cursor-pointer',
        },
      }),
      CustomTable.configure({ resizable: true, View: CustomTableView }),
      TableRowResizing,
      TableRow,
      CustomTableHeader,
      CustomTableCell,
      TextAlign.configure({
        types: ['heading', 'paragraph', 'listItem', 'bulletList', 'orderedList'],
      }),
    ],
    content: convertMarkdownTablesToHtml(content || ''),
    editable,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: `prose prose-sm dark:prose-invert max-w-none focus:outline-none h-full ${className} ${showParagraphMarks ? 'show-paragraph-marks' : ''}`,
      },
      handlePaste: (view, event) => {
        const pastedText = event.clipboardData?.getData('text/plain');
        if (pastedText && isBijoyText(pastedText)) {
          const converted = convertBijoyToUnicode(pastedText);
          view.dispatch(view.state.tr.replaceSelectionWith(view.state.schema.text(converted)));
          toast.info("Bijoy text auto-converted to Unicode Bangla");
          return true;
        }
        return false;
      },
      handleKeyDown: (view, event) => {
        if (event.key === 'Tab') {
          const pos = view.state.selection.$from;
          let inTable = false;
          for (let d = pos.depth; d > 0; d--) {
            if (pos.node(d).type.name === 'table') { inTable = true; break; }
          }
          if (inTable) {
            event.preventDefault();
            return handleTableTabNavigationWithView(view, event.shiftKey);
          }
        }

        if (event.key === 'Enter' && event.shiftKey) {
          const pos = view.state.selection.$from;
          let inTable = false;
          for (let d = pos.depth; d > 0; d--) {
            if (pos.node(d).type.name === 'table') { inTable = true; break; }
          }
          if (inTable) {
            event.preventDefault();
            return handleTableShiftEnterNavigation(view);
          }
        }

        // Ctrl/Cmd+S is handled by the window-level listener above (it also fires
        // for this in-content case as the event bubbles), so it is intentionally
        // not intercepted here to avoid triggering the host's save twice.

        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
          event.preventDefault();
          setIsFindReplaceOpen(true);
          return true;
        }

        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key === 'Enter') {
          event.preventDefault();
          editor?.chain().focus().insertContent('<hr class="page-break" style="page-break-after: always; border-top: 2px dashed #94a3b8; margin: 24px 0;" />').run();
          return true;
        }
        return false;
      },
    },
  });

  useEffect(() => {
    if (editor && !editor.isDestroyed && content !== editor.getHTML()) {
      const processed = convertMarkdownTablesToHtml(content || '');
      editor.commands.setContent(processed, { emitUpdate: false });
    }
  }, [content, editor]);

  const wordCount = editor?.storage.characterCount.words() || 0;
  const charCount = editor?.storage.characterCount.characters() || 0;
  const estimatedPages = Math.max(1, Math.ceil(wordCount / 350));

  return (
    <div className={
      isFullscreen
        ? "fixed inset-0 z-[99999] bg-background text-foreground flex flex-col h-screen w-screen overflow-hidden"
        : `flex flex-col w-full h-full bg-background overflow-hidden rounded-xl ${!editable ? 'opacity-70 cursor-not-allowed' : ''}`
    }>
      {editable && (
        <>
          <MenuBar 
            editor={editor} 
            viewMode={viewMode}
            setViewMode={setViewMode}
            zoomLevel={zoomLevel}
            setZoomLevel={setZoomLevel}
            onOpenFindReplace={() => setIsFindReplaceOpen(true)}
            isFullscreen={isFullscreen}
            setIsFullscreen={setIsFullscreen}
            showParagraphMarks={showParagraphMarks}
            setShowParagraphMarks={setShowParagraphMarks}
            showRuler={showRuler}
            setShowRuler={setShowRuler}
            pageSettings={pageSettings}
            setPageSettings={setPageSettings}
          />
          <FindReplaceDrawer
            isOpen={isFindReplaceOpen}
            onClose={() => setIsFindReplaceOpen(false)}
            editor={editor}
          />
          {showRuler && (
            <WordRuler
              viewMode={viewMode}
              pageWidthMm={pageWidthMm}
              marginLeftMm={pageSettings.margins.left}
              marginRightMm={pageSettings.margins.right}
            />
          )}
        </>
      )}

      {/* EDITOR CANVAS AREA */}
      <div
        className={`flex-1 overflow-y-auto ${viewMode === 'pageView' ? 'bg-muted/70 dark:bg-zinc-900 p-6 flex justify-center' : 'p-6 bg-background'} ${!editable ? 'pointer-events-none' : ''}`}
        style={{ transform: zoomLevel !== 100 ? `scale(${zoomLevel / 100})` : undefined, transformOrigin: 'top center' }}
      >
        <div
          className={
            viewMode === 'pageView'
              ? "h-auto bg-card shadow-xl rounded-sm relative my-2 flex flex-col transition-all overflow-x-auto shrink-0"
              : "w-full min-h-full h-auto bg-card p-6 rounded-xl flex flex-col transition-all overflow-x-auto"
          }
          style={viewMode === 'pageView' ? {
            width: `${pageWidthMm}mm`,
            minHeight: `${pageHeightMm}mm`,
            paddingTop: `${pageSettings.margins.top}mm`,
            paddingRight: `${pageSettings.margins.right}mm`,
            paddingBottom: `${pageSettings.margins.bottom}mm`,
            paddingLeft: `${pageSettings.margins.left}mm`,
            backgroundColor: pageSettings.pageColor || undefined,
            border: pageSettings.border.enabled
              ? `${pageSettings.border.width}pt ${pageSettings.border.style} ${pageSettings.border.color}`
              : undefined,
          } : undefined}
        >
          {viewMode === 'pageView' && pageSettings.watermark.enabled && (
            <div
              aria-hidden="true"
              className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none select-none"
              style={{ zIndex: 0 }}
            >
              <span
                style={{
                  fontSize: '80px',
                  fontWeight: 800,
                  color: pageSettings.watermark.color,
                  opacity: pageSettings.watermark.opacity,
                  transform: 'rotate(-38deg)',
                  whiteSpace: 'nowrap',
                  textTransform: 'uppercase',
                  letterSpacing: '4px',
                }}
              >
                {pageSettings.watermark.text}
              </span>
            </div>
          )}

          <EditorContent editor={editor} className="min-h-full cursor-text flex-1 flex flex-col relative z-[1]" />
        </div>
      </div>

      {/* AUTHENTIC MS WORD 2007 STATUS BAR FOOTER */}
      {editable && editor && (
        <div className="bg-muted/90 px-4 py-1 flex items-center justify-between text-[11px] font-bold text-muted-foreground select-none">
          {/* Left info */}
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1">
              <FileText className="w-3.5 h-3.5 text-primary" />
              <span>Page {estimatedPages} of {estimatedPages}</span>
            </span>
            <span>{wordCount} Words</span>
            <span>{charCount} Characters</span>
            <span className="px-1.5 py-0.5 rounded bg-card text-[10px] text-foreground">English / বাংলা</span>
          </div>

          {/* Right controls: View shortcuts & Interactive Zoom Slider */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 pr-3">
              <button
                type="button"
                onClick={() => setViewMode('pageView')}
                className={`p-1 rounded cursor-pointer ${viewMode === 'pageView' ? 'bg-primary text-primary-foreground font-bold' : 'hover:bg-card text-muted-foreground'}`}
                title="Print Layout View"
              >
                <FileText className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setViewMode('fluid')}
                className={`p-1 rounded cursor-pointer ${viewMode === 'fluid' ? 'bg-primary text-primary-foreground font-bold' : 'hover:bg-card text-muted-foreground'}`}
                title="Fluid Canvas View"
              >
                <Layout className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Interactive Zoom Controls */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setZoomLevel(Math.max(75, zoomLevel - 10))}
                className="p-0.5 hover:bg-card rounded cursor-pointer text-xs font-bold"
                title="Zoom Out"
              >
                -
              </button>
              <input
                type="range"
                min={75}
                max={150}
                step={5}
                value={zoomLevel}
                onChange={(e) => setZoomLevel(parseInt(e.target.value, 10))}
                className="w-20 accent-primary cursor-pointer h-1.5 rounded bg-muted-foreground/30"
              />
              <button
                type="button"
                onClick={() => setZoomLevel(Math.min(150, zoomLevel + 10))}
                className="p-0.5 hover:bg-card rounded cursor-pointer text-xs font-bold"
                title="Zoom In"
              >
                +
              </button>
              <span className="w-10 text-right text-[11px] font-extrabold text-primary">{zoomLevel}%</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
