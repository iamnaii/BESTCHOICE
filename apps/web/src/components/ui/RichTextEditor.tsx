import { Bold, Italic, Underline, Strikethrough } from '@/lib/icons';

import {
  AlignCenter as InlineAlignCenterIcon,
  AlignLeft as InlineAlignLeftIcon,
  AlignRight as InlineAlignRightIcon,
  Indent as InlineIndentIcon,
  List as InlineListIcon,
  ListOrdered as InlineListOrderedIcon,
  Minus as InlineMinusIcon,
  Outdent as InlineOutdentIcon,
  Redo2 as InlineRedo2Icon,
  Table as InlineTableIcon,
  Undo2 as InlineUndo2Icon,
} from '@/lib/icons';
import { NativeSelect } from '@/components/ui/native-select';
import { useRef, useCallback, useEffect, useState } from 'react';
import DOMPurify from 'dompurify';

interface RichTextEditorProps {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: string;
  /** Called when a file is dropped onto the editor */
  onFileDrop?: (file: File) => void;
}

type FormatAction =
  | { type: 'command'; command: string; value?: string }
  | { type: 'tag'; tag: string };

interface ToolbarButton {
  label: string;
  icon: string;
  title: string;
  action: FormatAction;
  active?: string; // queryCommandState key
}

interface ToolbarGroup {
  buttons: ToolbarButton[];
}

const TOOLBAR: ToolbarGroup[] = [
  {
    buttons: [
      { label: 'B', icon: 'bold', title: 'ตัวหนา (Ctrl+B)', action: { type: 'command', command: 'bold' }, active: 'bold' },
      { label: 'I', icon: 'italic', title: 'ตัวเอียง (Ctrl+I)', action: { type: 'command', command: 'italic' }, active: 'italic' },
      { label: 'U', icon: 'underline', title: 'ขีดเส้นใต้ (Ctrl+U)', action: { type: 'command', command: 'underline' }, active: 'underline' },
      { label: 'S', icon: 'strikethrough', title: 'ขีดฆ่า', action: { type: 'command', command: 'strikeThrough' }, active: 'strikeThrough' },
    ],
  },
  {
    buttons: [
      { label: '', icon: 'align-left', title: 'จัดชิดซ้าย', action: { type: 'command', command: 'justifyLeft' }, active: 'justifyLeft' },
      { label: '', icon: 'align-center', title: 'จัดกึ่งกลาง', action: { type: 'command', command: 'justifyCenter' }, active: 'justifyCenter' },
      { label: '', icon: 'align-right', title: 'จัดชิดขวา', action: { type: 'command', command: 'justifyRight' }, active: 'justifyRight' },
    ],
  },
  {
    buttons: [
      { label: '', icon: 'list-ul', title: 'รายการแบบจุด', action: { type: 'command', command: 'insertUnorderedList' } },
      { label: '', icon: 'list-ol', title: 'รายการแบบตัวเลข', action: { type: 'command', command: 'insertOrderedList' } },
    ],
  },
  {
    buttons: [
      { label: '', icon: 'indent', title: 'เพิ่มย่อหน้า', action: { type: 'command', command: 'indent' } },
      { label: '', icon: 'outdent', title: 'ลดย่อหน้า', action: { type: 'command', command: 'outdent' } },
    ],
  },
  {
    buttons: [
      { label: '', icon: 'hr', title: 'เส้นคั่น', action: { type: 'command', command: 'insertHorizontalRule' } },
      { label: '', icon: 'table', title: 'แทรกตาราง', action: { type: 'tag', tag: 'table' } },
      { label: '', icon: 'undo', title: 'ย้อนกลับ (Ctrl+Z)', action: { type: 'command', command: 'undo' } },
      { label: '', icon: 'redo', title: 'ทำซ้ำ (Ctrl+Y)', action: { type: 'command', command: 'redo' } },
    ],
  },
];

function ToolbarIcon({ icon }: { icon: string }) {
  switch (icon) {
    case 'bold':
      return <Bold className="size-3.5" aria-hidden="true" />;
    case 'italic':
      return <Italic className="size-3.5" aria-hidden="true" />;
    case 'underline':
      return <Underline className="size-3.5" aria-hidden="true" />;
    case 'strikethrough':
      return <Strikethrough className="size-3.5" aria-hidden="true" />;
    case 'align-left':
      return (
        <InlineAlignLeftIcon className="w-3.5 h-3.5" aria-hidden="true" />
      );
    case 'align-center':
      return (
        <InlineAlignCenterIcon className="w-3.5 h-3.5" aria-hidden="true" />
      );
    case 'align-right':
      return (
        <InlineAlignRightIcon className="w-3.5 h-3.5" aria-hidden="true" />
      );
    case 'list-ul':
      return (
        <InlineListIcon className="w-3.5 h-3.5" aria-hidden="true" />
      );
    case 'list-ol':
      return (
        <InlineListOrderedIcon className="w-3.5 h-3.5" aria-hidden="true" />
      );
    case 'indent':
      return (
        <InlineIndentIcon className="w-3.5 h-3.5" aria-hidden="true" />
      );
    case 'outdent':
      return (
        <InlineOutdentIcon className="w-3.5 h-3.5" aria-hidden="true" />
      );
    case 'hr':
      return (
        <InlineMinusIcon className="w-3.5 h-3.5" aria-hidden="true" />
      );
    case 'table':
      return (
        <InlineTableIcon className="w-3.5 h-3.5" aria-hidden="true" />
      );
    case 'undo':
      return (
        <InlineUndo2Icon className="w-3.5 h-3.5" aria-hidden="true" />
      );
    case 'redo':
      return (
        <InlineRedo2Icon className="w-3.5 h-3.5" aria-hidden="true" />
      );
    default:
      return <span className="text-xs">{icon}</span>;
  }
}

export default function RichTextEditor({ value, onChange, placeholder, minHeight = '380px', onFileDrop }: RichTextEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const isInternalUpdate = useRef(false);
  const [activeStates, setActiveStates] = useState<Record<string, boolean>>({});
  const [fontSize, setFontSize] = useState('3');
  const [showSource, setShowSource] = useState(false);
  const [sourceValue, setSourceValue] = useState('');

  // Sync external value to editor
  useEffect(() => {
    if (isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }
    const editor = editorRef.current;
    if (editor && editor.innerHTML !== value) {
      editor.innerHTML = DOMPurify.sanitize(value);
    }
  }, [value]);

  const emitChange = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    isInternalUpdate.current = true;
    onChange(editor.innerHTML);
  }, [onChange]);

  const execCommand = useCallback((command: string, val?: string) => {
    document.execCommand(command, false, val);
    editorRef.current?.focus();
    emitChange();
    updateActiveStates();
  }, [emitChange]);

  const handleAction = useCallback((action: FormatAction) => {
    if (action.type === 'command') {
      execCommand(action.command, action.value);
    } else if (action.type === 'tag' && action.tag === 'table') {
      const tableHtml = '<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%"><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr></table><p></p>';
      document.execCommand('insertHTML', false, tableHtml);
      editorRef.current?.focus();
      emitChange();
    }
  }, [execCommand, emitChange]);

  const updateActiveStates = useCallback(() => {
    const states: Record<string, boolean> = {};
    const commands = ['bold', 'italic', 'underline', 'strikeThrough', 'justifyLeft', 'justifyCenter', 'justifyRight'];
    for (const cmd of commands) {
      try { states[cmd] = document.queryCommandState(cmd); } catch { states[cmd] = false; }
    }
    setActiveStates(states);
  }, []);

  const handleFontSize = useCallback((size: string) => {
    setFontSize(size);
    execCommand('fontSize', size);
  }, [execCommand]);

  const handleHeading = useCallback((tag: string) => {
    execCommand('formatBlock', tag);
  }, [execCommand]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    if (onFileDrop) {
      const file = e.dataTransfer.files[0];
      if (file) {
        e.preventDefault();
        onFileDrop(file);
      }
    }
  }, [onFileDrop]);

  const toggleSource = useCallback(() => {
    if (showSource) {
      // Switching back to visual mode — apply source changes
      onChange(sourceValue);
      setShowSource(false);
    } else {
      // Switching to source mode
      setSourceValue(value);
      setShowSource(true);
    }
  }, [showSource, sourceValue, value, onChange]);

  return (
    <div className="border border-input rounded-lg overflow-hidden bg-card flex flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 bg-muted border-b border-border">
        {/* Heading select */}
        <NativeSelect wrapperClassName="max-w-full w-auto mr-1"
          onChange={(e) => handleHeading(e.target.value)}
          defaultValue="p"
        >
          <option value="p">ย่อหน้า</option>
          <option value="h1">หัวข้อ 1</option>
          <option value="h2">หัวข้อ 2</option>
          <option value="h3">หัวข้อ 3</option>
          <option value="h4">หัวข้อ 4</option>
        </NativeSelect>

        {/* Font size */}
        <NativeSelect wrapperClassName="max-w-full w-auto mr-1"
          value={fontSize}
          onChange={(e) => handleFontSize(e.target.value)}
        >
          <option value="1">เล็กมาก</option>
          <option value="2">เล็ก</option>
          <option value="3">ปกติ</option>
          <option value="4">ใหญ่</option>
          <option value="5">ใหญ่มาก</option>
          <option value="6">หัวข้อใหญ่</option>
        </NativeSelect>

        {/* Divider */}
        <div className="w-px h-5 bg-border mx-1" />

        {/* Button groups */}
        {TOOLBAR.map((group, gi) => (
          <div key={gi} className="flex items-center">
            {group.buttons.map((btn) => (
              <button data-ui-control="button" data-ui-icon="true"
                key={btn.icon}
                type="button"
                title={btn.title}
                onMouseDown={(e) => { e.preventDefault(); handleAction(btn.action); }}
                className={`p-1.5 rounded transition-colors ${
                  btn.active && activeStates[btn.active]
                    ? 'bg-primary-100 text-primary-700'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                <ToolbarIcon icon={btn.icon} />
              </button>
            ))}
            {gi < TOOLBAR.length - 1 && <div className="w-px h-5 bg-border mx-1" />}
          </div>
        ))}

        {/* Source toggle */}
        <div className="w-px h-5 bg-border mx-1" />
        <button data-ui-control="button"
          type="button"
          title={showSource ? 'โหมดแก้ไข' : 'ดู HTML'}
          onMouseDown={(e) => { e.preventDefault(); toggleSource(); }}
          className={`px-2 py-1 text-xs rounded transition-colors ${
            showSource ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted'
          }`}
        >
          {'</>'}
        </button>
      </div>

      {/* Editor area */}
      {showSource ? (
        <textarea
          value={sourceValue}
          onChange={(e) => setSourceValue(e.target.value)}
          className="flex-1 px-4 py-3 text-xs font-mono resize-none focus:outline-hidden"
          style={{ minHeight }}
          spellCheck={false}
        />
      ) : (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          className="flex-1 px-4 py-3 text-sm focus:outline-hidden overflow-auto"
          style={{ minHeight }}
          onInput={emitChange}
          onKeyUp={updateActiveStates}
          onMouseUp={updateActiveStates}
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          data-placeholder={placeholder}
        />
      )}
    </div>
  );
}
