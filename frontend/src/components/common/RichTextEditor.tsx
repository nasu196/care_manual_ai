import React from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import {
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Undo,
  Redo,
  LayoutGrid, 
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpToLine,
  ArrowDownToLine,
  Trash2,
  Menu,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import { Separator } from '@/components/ui/separator';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

interface RichTextEditorProps {
  content: string; // HTML文字列を期待
  onChange: (htmlContent: string) => void;
  editable?: boolean;
}

const RichTextEditor: React.FC<RichTextEditorProps> = ({
  content,
  onChange,
  editable = true,
}) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Table.configure({
        resizable: true, 
      }),
      TableRow,
      TableHeader, 
      TableCell,   
    ],
    content: content, // HTML文字列を直接セット
    editable: editable,
    onUpdate: ({ editor }) => {
      const htmlContent = editor.getHTML();
      onChange(htmlContent); // HTMLをそのまま返す
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm dark:prose-invert max-w-full focus:outline-none p-3 h-full',
      },
    },
  });

  React.useEffect(() => {
    if (!editor || content === undefined) {
      return;
    }
    // 外部から content が変更された場合、エディタのコンテンツを更新
    // ただし、現在のエディタのHTMLと新しいHTMLが異なる場合のみ
    // かつ、エディタがフォーカスされていない場合（ユーザー入力中を避ける）
    if (!editor.isFocused && editor.getHTML() !== content) {
      editor.commands.setContent(content, false); // 第2引数 false で onUpdate をトリガーしない
    }
  }, [content, editor]);

  if (!editor) {
    return null;
  }

  return (
    <div className="border rounded-md flex flex-col h-full">
      {editable && (
        <div className="p-2 border-b flex flex-nowrap items-center gap-1 overflow-x-auto sm:flex-wrap sm:overflow-x-visible">
          <Button
            variant="outline"
            size="sm"
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            className={editor.isActive('heading', { level: 1 }) ? 'bg-accent text-accent-foreground' : ''}
            title="Heading 1"
          >
            <Heading1 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={editor.isActive('heading', { level: 2 }) ? 'bg-accent text-accent-foreground' : ''}
            title="Heading 2"
          >
            <Heading2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={editor.isActive('heading', { level: 3 }) ? 'bg-accent text-accent-foreground' : ''}
            title="Heading 3"
          >
            <Heading3 className="h-3.5 w-3.5" />
          </Button>
          <Separator orientation="vertical" className="h-6 mx-1" />
          <Toggle
            size="sm"
            pressed={editor.isActive('bold')}
            onPressedChange={() => editor.chain().focus().toggleBold().run()}
            title="Bold"
          >
            <Bold className="h-3.5 w-3.5" />
          </Toggle>
          <Toggle
            size="sm"
            pressed={editor.isActive('italic')}
            onPressedChange={() => editor.chain().focus().toggleItalic().run()}
            title="Italic"
          >
            <Italic className="h-3.5 w-3.5" />
          </Toggle>
          <Toggle
            size="sm"
            pressed={editor.isActive('strike')}
            onPressedChange={() => editor.chain().focus().toggleStrike().run()}
            title="Strikethrough"
          >
            <Strikethrough className="h-3.5 w-3.5" />
          </Toggle>
          <Separator orientation="vertical" className="h-6 mx-1" />

          {/* Hamburger Menu for list, table, and history operations */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" title="その他の操作">
                <Menu className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* List Operations added here */}
              <DropdownMenuItem onClick={() => editor.chain().focus().toggleBulletList().run()} disabled={!editor.can().toggleBulletList()}>
                <List className="mr-2 h-3.5 w-3.5" />
                <span>箇条書き (・)</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().toggleOrderedList().run()} disabled={!editor.can().toggleOrderedList()}>
                <ListOrdered className="mr-2 h-3.5 w-3.5" />
                <span>番号付きリスト (1.)</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* Table Operations (existing items from previous step) */}
              <DropdownMenuItem onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} >
                <LayoutGrid className="mr-2 h-3.5 w-3.5" />
                <span>表を挿入</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => editor.chain().focus().addColumnBefore().run()} disabled={!editor.can().addColumnBefore() || !editor.isActive('table')} >
                <ArrowLeftToLine className="mr-2 h-3.5 w-3.5" />
                <span>左に列を追加</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().addColumnAfter().run()} disabled={!editor.can().addColumnAfter() || !editor.isActive('table')} >
                <ArrowRightToLine className="mr-2 h-3.5 w-3.5" />
                <span>右に列を追加</span>
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => editor.chain().focus().deleteColumn().run()} 
                disabled={!editor.can().deleteColumn() || !editor.isActive('table')}
                // className="text-red-600 hover:!text-red-600 hover:!bg-red-50 dark:hover:!bg-red-900/50" // Still commented out
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                <span>列を削除</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => editor.chain().focus().addRowBefore().run()} disabled={!editor.can().addRowBefore() || !editor.isActive('table')} >
                <ArrowUpToLine className="mr-2 h-3.5 w-3.5" />
                <span>上に行を追加</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().addRowAfter().run()} disabled={!editor.can().addRowAfter() || !editor.isActive('table')} >
                <ArrowDownToLine className="mr-2 h-3.5 w-3.5" />
                <span>下に行を追加</span>
              </DropdownMenuItem>
              <DropdownMenuItem 
                onClick={() => editor.chain().focus().deleteRow().run()} 
                disabled={!editor.can().deleteRow() || !editor.isActive('table')}
                // className="text-red-600 hover:!text-red-600 hover:!bg-red-50 dark:hover:!bg-red-900/50" // Still commented out
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                <span>行を削除</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                onClick={() => editor.chain().focus().deleteTable().run()} 
                disabled={!editor.can().deleteTable() || !editor.isActive('table')}
                // className="text-red-600 hover:!text-red-600 hover:!bg-red-50 dark:hover:!bg-red-900/50" // Still commented out
              >
                <Trash2 className="mr-2 h-3.5 w-3.5" />
                <span>表を削除</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* History Operations (existing items from previous step) */}
              <DropdownMenuItem onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} >
                <Undo className="mr-2 h-3.5 w-3.5" />
                <span>元に戻す (Undo)</span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} >
                <Redo className="mr-2 h-3.5 w-3.5" />
                <span>やり直す (Redo)</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      <div className="flex-grow overflow-y-auto">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};

export default RichTextEditor; 