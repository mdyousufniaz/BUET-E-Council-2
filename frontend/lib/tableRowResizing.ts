/**
 * Drag-to-resize table ROWS, mirroring prosemirror-tables' own `columnResizing`
 * plugin (which only handles columns out of the box). Same interaction model:
 * hover near a row's bottom border -> cursor changes and a handle bar shows;
 * drag it to preview live; release to commit.
 *
 * Row height is stored the same way the existing preset buttons
 * (Compact/Medium/Tall in the ribbon) already store it: a `height: Npx`
 * declaration inside each cell's `style` attribute. That keeps both
 * mechanisms compatible and means resized rows export/print the same way
 * cells with a manually-set height already do.
 */
import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import { TableMap, cellAround, pointsAtCell } from '@tiptap/pm/tables';
import type { Node as PMNode } from '@tiptap/pm/model';

export const rowResizingPluginKey = new PluginKey('rowResizing');

type Dragging = false | { startY: number; startHeight: number };

class RowResizeState {
  constructor(public activeHandle: number, public dragging: Dragging) {}

  apply(tr: Transaction): RowResizeState {
    const action = tr.getMeta(rowResizingPluginKey);
    if (action && action.setHandle != null) return new RowResizeState(action.setHandle, false);
    if (action && action.setDragging !== undefined) return new RowResizeState(this.activeHandle, action.setDragging);
    if (this.activeHandle > -1 && tr.docChanged) {
      let handle = tr.mapping.map(this.activeHandle, -1);
      if (!pointsAtCell(tr.doc.resolve(handle))) handle = -1;
      return new RowResizeState(handle, this.dragging);
    }
    return this;
  }
}

function domCellAround(target: EventTarget | null): HTMLElement | null {
  let node = target as HTMLElement | null;
  while (node && node.nodeName !== 'TD' && node.nodeName !== 'TH') {
    if (node.classList && node.classList.contains('ProseMirror')) return null;
    node = node.parentNode as HTMLElement | null;
  }
  return node;
}

function edgeCell(view: EditorView, event: MouseEvent, handleWidth: number): number {
  const found = view.posAtCoords({ left: event.clientX, top: event.clientY - handleWidth });
  if (!found) return -1;
  const $cell = cellAround(view.state.doc.resolve(found.pos));
  return $cell ? $cell.pos : -1;
}

function handleMouseMove(view: EditorView, event: MouseEvent, handleWidth: number) {
  if (!view.editable) return;
  const pluginState = rowResizingPluginKey.getState(view.state);
  if (!pluginState) return;
  if (!pluginState.dragging) {
    const target = domCellAround(event.target);
    let cell = -1;
    if (target) {
      const { bottom } = target.getBoundingClientRect();
      if (Math.abs(event.clientY - bottom) <= handleWidth) {
        cell = edgeCell(view, event, handleWidth);
      }
    }
    if (cell !== pluginState.activeHandle) updateHandle(view, cell);
  }
}

function handleMouseLeave(view: EditorView) {
  if (!view.editable) return;
  const pluginState = rowResizingPluginKey.getState(view.state);
  if (pluginState && pluginState.activeHandle > -1 && !pluginState.dragging) updateHandle(view, -1);
}

function handleMouseDown(view: EditorView, event: MouseEvent, cellMinHeight: number): boolean {
  if (!view.editable) return false;
  const win = view.dom.ownerDocument.defaultView || window;
  const pluginState = rowResizingPluginKey.getState(view.state);
  if (!pluginState || pluginState.activeHandle === -1 || pluginState.dragging) return false;

  const cellPos = pluginState.activeHandle;
  const cellDom = view.nodeDOM(cellPos) as HTMLElement | null;
  const rowDom = cellDom?.closest('tr') || null;
  if (!rowDom) return false;
  const startHeight = rowDom.getBoundingClientRect().height;

  view.dispatch(view.state.tr.setMeta(rowResizingPluginKey, {
    setDragging: { startY: event.clientY, startHeight },
  }));

  function finish(e: MouseEvent) {
    win.removeEventListener('mouseup', finish);
    win.removeEventListener('mousemove', move);
    const pluginState2 = rowResizingPluginKey.getState(view.state);
    if (pluginState2?.dragging) {
      updateRowHeight(view, cellPos, draggedHeight(pluginState2.dragging, e, cellMinHeight));
      view.dispatch(view.state.tr.setMeta(rowResizingPluginKey, { setDragging: null }));
    }
  }
  function move(e: MouseEvent) {
    if (!e.buttons) return finish(e);
    const pluginState2 = rowResizingPluginKey.getState(view.state);
    if (!pluginState2) return;
    if (pluginState2.dragging) {
      displayRowHeight(view, cellPos, draggedHeight(pluginState2.dragging, e, cellMinHeight));
    }
  }

  win.addEventListener('mouseup', finish);
  win.addEventListener('mousemove', move);
  event.preventDefault();
  return true;
}

function draggedHeight(dragging: { startY: number; startHeight: number }, event: MouseEvent, cellMinHeight: number) {
  const offset = event.clientY - dragging.startY;
  return Math.max(cellMinHeight, Math.round(dragging.startHeight + offset));
}

function updateHandle(view: EditorView, value: number) {
  view.dispatch(view.state.tr.setMeta(rowResizingPluginKey, { setHandle: value }));
}

function mergeStyleHeight(style: string | null | undefined, height: number): string {
  const declarations = (style || '')
    .split(';')
    .map((d) => d.trim())
    .filter((d) => d && !/^height\s*:/i.test(d));
  declarations.push(`height: ${height}px`);
  return declarations.join('; ') + ';';
}

/** Live visual-only preview while dragging; the real doc update happens on mouseup. */
function displayRowHeight(view: EditorView, cellPos: number, height: number) {
  const cellDom = view.nodeDOM(cellPos) as HTMLElement | null;
  const rowDom = cellDom?.closest('tr') || null;
  if (!rowDom) return;
  rowDom.style.height = `${height}px`;
  Array.from(rowDom.children).forEach((cell) => {
    (cell as HTMLElement).style.height = `${height}px`;
  });
}

function updateRowHeight(view: EditorView, cellPos: number, height: number) {
  const $cell = view.state.doc.resolve(cellPos);
  const table = $cell.node(-1) as PMNode | null;
  if (!table) return;
  const map = TableMap.get(table);
  const start = $cell.start(-1);
  const { top: row } = map.findCell(cellPos - start);
  const tr = view.state.tr;
  const seen = new Set<number>();
  for (let col = 0; col < map.width; col++) {
    const mapPos = map.map[row * map.width + col];
    if (seen.has(mapPos)) continue;
    seen.add(mapPos);
    if (map.findCell(mapPos).top !== row) continue; // skip rowspan continuations from an earlier row
    const node = table.nodeAt(mapPos);
    if (!node) continue;
    const style = mergeStyleHeight(node.attrs.style, height);
    if (style === node.attrs.style) continue;
    tr.setNodeMarkup(start + mapPos, null, { ...node.attrs, style });
  }
  if (tr.docChanged) view.dispatch(tr);
}

function handleDecorations(state: EditorState, cellPos: number) {
  const decorations: Decoration[] = [];
  const $cell = state.doc.resolve(cellPos);
  const table = $cell.node(-1) as PMNode | null;
  if (!table) return DecorationSet.empty;
  const map = TableMap.get(table);
  const start = $cell.start(-1);
  const { top: row } = map.findCell(cellPos - start);
  const seen = new Set<number>();
  const pluginState = rowResizingPluginKey.getState(state);
  for (let col = 0; col < map.width; col++) {
    const mapPos = map.map[row * map.width + col];
    if (seen.has(mapPos)) continue;
    seen.add(mapPos);
    const info = map.findCell(mapPos);
    if (info.bottom - 1 !== row) continue; // only cells whose bottom border is this row's bottom
    const node = table.nodeAt(mapPos);
    if (!node) continue;
    if (pluginState?.dragging) {
      decorations.push(Decoration.node(start + mapPos, start + mapPos + node.nodeSize, { class: 'row-resize-dragging' }));
    }
    const pos = start + mapPos + node.nodeSize - 1;
    const dom = document.createElement('div');
    dom.className = 'row-resize-handle';
    decorations.push(Decoration.widget(pos, dom));
  }
  return DecorationSet.create(state.doc, decorations);
}

export interface RowResizingOptions {
  handleWidth?: number;
  cellMinHeight?: number;
}

export function rowResizing({ handleWidth = 6, cellMinHeight = 20 }: RowResizingOptions = {}) {
  return new Plugin({
    key: rowResizingPluginKey,
    state: {
      init: () => new RowResizeState(-1, false),
      apply(tr, prev) {
        return (prev as RowResizeState).apply(tr);
      },
    },
    props: {
      attributes: (state): Record<string, string> => {
        const pluginState = rowResizingPluginKey.getState(state);
        if (pluginState && pluginState.activeHandle > -1) return { class: 'row-resize-cursor' };
        return {};
      },
      handleDOMEvents: {
        mousemove: (view, event) => {
          handleMouseMove(view, event as MouseEvent, handleWidth);
          return false;
        },
        mouseleave: (view) => {
          handleMouseLeave(view);
          return false;
        },
        mousedown: (view, event) => handleMouseDown(view, event as MouseEvent, cellMinHeight),
      },
      decorations: (state) => {
        const pluginState = rowResizingPluginKey.getState(state);
        if (pluginState && pluginState.activeHandle > -1) return handleDecorations(state, pluginState.activeHandle);
        return null;
      },
    },
  });
}
