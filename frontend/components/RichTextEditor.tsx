"use client";

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { FontFamily } from '@tiptap/extension-font-family';
import { TextStyle } from '@tiptap/extension-text-style';
import { 
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, 
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Quote, Undo, Redo,
  Table as TableIcon, LayoutTemplate, Trash2, Columns, Rows, Settings
} from 'lucide-react';
import { useEffect, useState } from 'react';
import CustomSelect from './CustomSelect';

const MenuBar = ({ editor }: { editor: any }) => {
  if (!editor) return null;

  return (
    <div className="bg-muted/50 border-b border-border p-2 flex flex-col gap-2 sticky top-0 z-10 w-full">
      {/* Primary Formatting Toolbar */}
      <div className="flex flex-wrap items-center gap-1">
        <div className="w-44">
          <CustomSelect
            value={editor.getAttributes('textStyle').fontFamily || ''}
            onChange={(val) => editor.chain().focus().setFontFamily(val).run()}
            options={[
              { value: "", label: "Default Font" },
              { value: "Inter", label: "English (Inter)" },
              { value: "Noto Sans Bengali, sans-serif", label: "Bangla (Noto Sans)" }
            ]}
          />
        </div>
        
        <div className="w-px h-6 bg-border mx-1" />

        <button
          onClick={() => editor.chain().focus().toggleBold().run()}
        disabled={!editor.can().chain().focus().toggleBold().run()}
        className={`p-2 rounded hover:bg-muted ${editor.isActive('bold') ? 'bg-muted text-primary' : 'text-muted-foreground'}`}
      >
        <Bold className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleItalic().run()}
        disabled={!editor.can().chain().focus().toggleItalic().run()}
        className={`p-2 rounded hover:bg-muted ${editor.isActive('italic') ? 'bg-muted text-primary' : 'text-muted-foreground'}`}
      >
        <Italic className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        disabled={!editor.can().chain().focus().toggleUnderline().run()}
        className={`p-2 rounded hover:bg-muted ${editor.isActive('underline') ? 'bg-muted text-primary' : 'text-muted-foreground'}`}
      >
        <UnderlineIcon className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleStrike().run()}
        disabled={!editor.can().chain().focus().toggleStrike().run()}
        className={`p-2 rounded hover:bg-muted ${editor.isActive('strike') ? 'bg-muted text-primary' : 'text-muted-foreground'}`}
      >
        <Strikethrough className="w-4 h-4" />
      </button>

      <div className="w-px h-6 bg-border mx-1" />

      <button
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
        className={`p-2 rounded hover:bg-muted ${editor.isActive({ textAlign: 'left' }) ? 'bg-muted text-primary' : 'text-muted-foreground'}`}
      >
        <AlignLeft className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
        className={`p-2 rounded hover:bg-muted ${editor.isActive({ textAlign: 'center' }) ? 'bg-muted text-primary' : 'text-muted-foreground'}`}
      >
        <AlignCenter className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
        className={`p-2 rounded hover:bg-muted ${editor.isActive({ textAlign: 'right' }) ? 'bg-muted text-primary' : 'text-muted-foreground'}`}
      >
        <AlignRight className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().setTextAlign('justify').run()}
        className={`p-2 rounded hover:bg-muted ${editor.isActive({ textAlign: 'justify' }) ? 'bg-muted text-primary' : 'text-muted-foreground'}`}
      >
        <AlignJustify className="w-4 h-4" />
      </button>

      <div className="w-px h-6 bg-border mx-1" />

      <button
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        className={`p-2 rounded hover:bg-muted ${editor.isActive('bulletList') ? 'bg-muted text-primary' : 'text-muted-foreground'}`}
      >
        <List className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        className={`p-2 rounded hover:bg-muted ${editor.isActive('orderedList') ? 'bg-muted text-primary' : 'text-muted-foreground'}`}
      >
        <ListOrdered className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        className={`p-2 rounded hover:bg-muted ${editor.isActive('blockquote') ? 'bg-muted text-primary' : 'text-muted-foreground'}`}
      >
        <Quote className="w-4 h-4" />
      </button>

      <div className="w-px h-6 bg-border mx-1" />

      <button
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().chain().focus().undo().run()}
        className="p-2 rounded hover:bg-muted text-muted-foreground disabled:opacity-50"
      >
        <Undo className="w-4 h-4" />
      </button>
      <button
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().chain().focus().redo().run()}
        className="p-2 rounded hover:bg-muted text-muted-foreground disabled:opacity-50"
      >
        <Redo className="w-4 h-4" />
      </button>

      <div className="w-px h-6 bg-border mx-1" />

      {/* Table Insertion button (always visible) */}
      <button
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
        className="p-2 rounded hover:bg-muted text-muted-foreground flex items-center gap-1 text-xs font-medium"
        title="Insert Table"
      >
        <TableIcon className="w-4 h-4" />
      </button>
      </div>

      {/* Secondary Table Management Toolbar (conditionally rendered) */}
      {editor.isActive('table') && (
        <div className="flex flex-wrap items-center gap-1 pt-2 border-t border-border/50">
          <span className="text-xs font-semibold uppercase text-primary tracking-wider mr-2">Table Tools</span>
          
          <button onClick={() => editor.chain().focus().addColumnBefore().run()} className="p-1.5 rounded hover:bg-muted text-muted-foreground text-xs font-medium flex items-center gap-1" title="Add Column Before">
            <Columns className="w-3.5 h-3.5" /> +Left
          </button>
          <button onClick={() => editor.chain().focus().addColumnAfter().run()} className="p-1.5 rounded hover:bg-muted text-muted-foreground text-xs font-medium flex items-center gap-1" title="Add Column After">
            <Columns className="w-3.5 h-3.5" /> +Right
          </button>
          <button onClick={() => editor.chain().focus().deleteColumn().run()} className="p-1.5 rounded hover:bg-muted text-destructive text-xs font-medium flex items-center gap-1" title="Delete Column">
            <Trash2 className="w-3.5 h-3.5" /> Col
          </button>
          
          <div className="w-px h-4 bg-border mx-1" />

          <button onClick={() => editor.chain().focus().addRowBefore().run()} className="p-1.5 rounded hover:bg-muted text-muted-foreground text-xs font-medium flex items-center gap-1" title="Add Row Above">
            <Rows className="w-3.5 h-3.5" /> +Above
          </button>
          <button onClick={() => editor.chain().focus().addRowAfter().run()} className="p-1.5 rounded hover:bg-muted text-muted-foreground text-xs font-medium flex items-center gap-1" title="Add Row Below">
            <Rows className="w-3.5 h-3.5" /> +Below
          </button>
          <button onClick={() => editor.chain().focus().deleteRow().run()} className="p-1.5 rounded hover:bg-muted text-destructive text-xs font-medium flex items-center gap-1" title="Delete Row">
            <Trash2 className="w-3.5 h-3.5" /> Row
          </button>

          <div className="w-px h-4 bg-border mx-1" />

          <button onClick={() => editor.chain().focus().toggleHeaderRow().run()} className="p-1.5 rounded hover:bg-muted text-muted-foreground text-xs font-medium flex items-center gap-1" title="Toggle Header Row">
            <Settings className="w-3.5 h-3.5" /> Header
          </button>
          <button onClick={() => editor.chain().focus().deleteTable().run()} className="p-1.5 rounded hover:bg-destructive/10 text-destructive text-xs font-medium flex items-center gap-1 bg-destructive/5" title="Delete Table">
            <Trash2 className="w-3.5 h-3.5" /> Table
          </button>
        </div>
      )}
    </div>
  );
};

export default function RichTextEditor({ 
  content, 
  onChange,
  className = "p-4 min-h-[150px]",
  editable = true
}: { 
  content: string; 
  onChange: (html: string) => void;
  className?: string;
  editable?: boolean;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextStyle,
      FontFamily,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
    ],
    content,
    editable,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
    editorProps: {
      attributes: {
        class: `prose prose-sm dark:prose-invert max-w-none focus:outline-none h-full ${className}`,
      },
    },
  });

  // Only update content from props if we are not focused (prevents cursor jumping)
  useEffect(() => {
    if (editor && content !== editor.getHTML() && !editor.isFocused) {
      editor.commands.setContent(content);
    }
  }, [content, editor]);

  return (
    <div className={`flex flex-col w-full h-full bg-background overflow-hidden ${!editable ? 'opacity-70 cursor-not-allowed' : ''}`}>
      {editable && <MenuBar editor={editor} />}
      <div className={`flex-1 overflow-y-auto ${!editable ? 'pointer-events-none' : ''}`}>
        <EditorContent editor={editor} className="h-full cursor-text" />
      </div>
    </div>
  );
}
