import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import Highlight from '@tiptap/extension-highlight';
import Placeholder from '@tiptap/extension-placeholder';
import IndentExtension from './IndentExtension';
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  List, ListOrdered, Undo2, Redo2,
  Heading1, Heading2, Heading3, Palette, Highlighter,
  RemoveFormatting, Indent, Outdent, IndentIncrease,
} from 'lucide-react';

interface Props {
  value: string;
  onChange: (html: string) => void;
  onEditorReady?: (editor: Editor) => void;
  placeholder?: string;
}

const COLORS = [
  '#000000', '#434343', '#666666', '#999999',
  '#b7b7b7', '#1a1a1a', '#c00000', '#ff0000',
  '#ff6600', '#ffc000', '#00b050', '#0070c0',
  '#002060', '#7030a0', '#6D28D9', '#9333ea',
];

const HIGHLIGHT_COLORS = [
  '#fef08a', '#bbf7d0', '#bfdbfe', '#fecaca',
  '#e9d5ff', '#fed7aa', '#f0abfc', '#99f6e4',
];

export default function RichTextEditor({ value, onChange, onEditorReady, placeholder }: Props) {
  // Track whether the change originated from the editor itself
  const isInternalChange = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
      }),
      Underline,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      IndentExtension,
      Placeholder.configure({
        placeholder: placeholder || 'พิมพ์เนื้อหา...',
      }),
    ],
    content: value,
    onUpdate: ({ editor: ed }) => {
      isInternalChange.current = true;
      onChange(ed.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none min-h-[240px] px-4 py-3',
      },
    },
  });

  // Notify parent when editor is ready (for variable insertion)
  useEffect(() => {
    if (editor && onEditorReady) {
      onEditorReady(editor);
    }
  }, [editor, onEditorReady]);

  // Sync external value changes only (skip if change came from editor itself)
  useEffect(() => {
    if (!editor) return;
    if (isInternalChange.current) {
      isInternalChange.current = false;
      return;
    }
    // External change — update editor content
    editor.commands.setContent(value, { emitUpdate: false });
  }, [value, editor]);

  if (!editor) return null;

  return (
    <div className="border border-gray-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 bg-gray-50 border-b border-gray-200">
        {/* Undo / Redo */}
        <ToolbarButton
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="ย้อนกลับ (Ctrl+Z)"
        >
          <Undo2 size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="ทำซ้ำ (Ctrl+Y)"
        >
          <Redo2 size={15} />
        </ToolbarButton>

        <Divider />

        {/* Headings */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          active={editor.isActive('heading', { level: 1 })}
          title="หัวเรื่องใหญ่"
        >
          <Heading1 size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor.isActive('heading', { level: 2 })}
          title="หัวเรื่อง"
        >
          <Heading2 size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor.isActive('heading', { level: 3 })}
          title="หัวข้อย่อย"
        >
          <Heading3 size={15} />
        </ToolbarButton>

        <Divider />

        {/* Text formatting */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          active={editor.isActive('bold')}
          title="ตัวหนา (Ctrl+B)"
        >
          <Bold size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          active={editor.isActive('italic')}
          title="ตัวเอียง (Ctrl+I)"
        >
          <Italic size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          active={editor.isActive('underline')}
          title="ขีดเส้นใต้ (Ctrl+U)"
        >
          <UnderlineIcon size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          active={editor.isActive('strike')}
          title="ขีดฆ่า"
        >
          <Strikethrough size={15} />
        </ToolbarButton>

        <Divider />

        {/* Text color */}
        <ColorDropdown
          icon={<Palette size={15} />}
          colors={COLORS}
          activeColor={editor.getAttributes('textStyle').color}
          onSelect={(color) => editor.chain().focus().setColor(color).run()}
          onClear={() => editor.chain().focus().unsetColor().run()}
          title="สีตัวอักษร"
        />

        {/* Highlight */}
        <ColorDropdown
          icon={<Highlighter size={15} />}
          colors={HIGHLIGHT_COLORS}
          activeColor={editor.getAttributes('highlight').color}
          onSelect={(color) => editor.chain().focus().toggleHighlight({ color }).run()}
          onClear={() => editor.chain().focus().unsetHighlight().run()}
          title="ไฮไลท์"
        />

        <Divider />

        {/* Alignment */}
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          active={editor.isActive({ textAlign: 'left' })}
          title="ชิดซ้าย"
        >
          <AlignLeft size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          active={editor.isActive({ textAlign: 'center' })}
          title="กึ่งกลาง"
        >
          <AlignCenter size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          active={editor.isActive({ textAlign: 'right' })}
          title="ชิดขวา"
        >
          <AlignRight size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('justify').run()}
          active={editor.isActive({ textAlign: 'justify' })}
          title="เต็มบรรทัด"
        >
          <AlignJustify size={15} />
        </ToolbarButton>

        <Divider />

        {/* Lists */}
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          active={editor.isActive('bulletList')}
          title="รายการ"
        >
          <List size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          active={editor.isActive('orderedList')}
          title="ลำดับเลข"
        >
          <ListOrdered size={15} />
        </ToolbarButton>

        {/* Indent / Outdent */}
        <ToolbarButton
          onClick={() => editor.chain().focus().indent().run()}
          title="เพิ่มย่อหน้า (Tab)"
        >
          <Indent size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().outdent().run()}
          title="ลดย่อหน้า (Shift+Tab)"
        >
          <Outdent size={15} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleFirstLineIndent().run()}
          active={editor.isActive({ firstLineIndent: true })}
          title="ย่อหน้าบรรทัดแรก (text-indent)"
        >
          <IndentIncrease size={15} />
        </ToolbarButton>

        <Divider />

        {/* Clear formatting */}
        <ToolbarButton
          onClick={() => editor.chain().focus().clearNodes().unsetAllMarks().run()}
          title="ล้างรูปแบบ"
        >
          <RemoveFormatting size={15} />
        </ToolbarButton>
      </div>

      {/* Editor content */}
      <EditorContent editor={editor} />
    </div>
  );
}

// --- Sub-components ---

function ToolbarButton({ onClick, active, disabled, title, children }: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`p-1.5 rounded transition-colors ${
        active
          ? 'bg-blue-100 text-blue-700'
          : 'text-gray-600 hover:bg-gray-200 hover:text-gray-800'
      } ${disabled ? 'opacity-30 cursor-not-allowed' : ''}`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-gray-300 mx-1" />;
}

function ColorDropdown({ icon, colors, activeColor, onSelect, onClear, title }: {
  icon: React.ReactNode;
  colors: string[];
  activeColor?: string;
  onSelect: (color: string) => void;
  onClear: () => void;
  title: string;
}) {
  return (
    <div className="relative group">
      <button
        type="button"
        className={`p-1.5 rounded transition-colors flex items-center gap-0.5 ${
          activeColor ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-200'
        }`}
        title={title}
      >
        {icon}
        {activeColor && (
          <div className="w-3 h-1 rounded-sm" style={{ backgroundColor: activeColor }} />
        )}
      </button>
      <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-xl z-50 p-2 hidden group-hover:block w-[176px]">
        <div className="grid grid-cols-4 gap-1 mb-2">
          {colors.map(color => (
            <button
              key={color}
              type="button"
              onClick={() => onSelect(color)}
              className={`w-8 h-8 rounded border-2 transition-transform hover:scale-110 ${
                activeColor === color ? 'border-blue-500 ring-1 ring-blue-300' : 'border-gray-200'
              }`}
              style={{ backgroundColor: color }}
              title={color}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={onClear}
          className="w-full text-xs text-gray-500 hover:text-gray-700 py-1 hover:bg-gray-50 rounded"
        >
          ล้างสี
        </button>
      </div>
    </div>
  );
}
