import { useRef, useCallback, useEffect, useState } from 'react';

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
      return <span className="font-bold text-xs">B</span>;
    case 'italic':
      return <span className="italic text-xs font-serif">I</span>;
    case 'underline':
      return <span className="underline text-xs">U</span>;
    case 'strikethrough':
      return <span className="line-through text-xs">S</span>;
    case 'align-left':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
          <rect x="1" y="2" width="14" height="1.5" rx="0.5" />
          <rect x="1" y="5.5" width="10" height="1.5" rx="0.5" />
          <rect x="1" y="9" width="14" height="1.5" rx="0.5" />
          <rect x="1" y="12.5" width="8" height="1.5" rx="0.5" />
        </svg>
      );
    case 'align-center':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
          <rect x="1" y="2" width="14" height="1.5" rx="0.5" />
          <rect x="3" y="5.5" width="10" height="1.5" rx="0.5" />
          <rect x="1" y="9" width="14" height="1.5" rx="0.5" />
          <rect x="4" y="12.5" width="8" height="1.5" rx="0.5" />
        </svg>
      );
    case 'align-right':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
          <rect x="1" y="2" width="14" height="1.5" rx="0.5" />
          <rect x="5" y="5.5" width="10" height="1.5" rx="0.5" />
          <rect x="1" y="9" width="14" height="1.5" rx="0.5" />
          <rect x="7" y="12.5" width="8" height="1.5" rx="0.5" />
        </svg>
      );
    case 'list-ul':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
          <circle cx="2.5" cy="3" r="1.2" />
          <rect x="5" y="2" width="10" height="1.5" rx="0.5" />
          <circle cx="2.5" cy="8" r="1.2" />
          <rect x="5" y="7" width="10" height="1.5" rx="0.5" />
          <circle cx="2.5" cy="13" r="1.2" />
          <rect x="5" y="12" width="10" height="1.5" rx="0.5" />
        </svg>
      );
    case 'list-ol':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
          <text x="1" y="4.5" fontSize="4.5" fontWeight="bold">1</text>
          <rect x="5" y="2" width="10" height="1.5" rx="0.5" />
          <text x="1" y="9.5" fontSize="4.5" fontWeight="bold">2</text>
          <rect x="5" y="7" width="10" height="1.5" rx="0.5" />
          <text x="1" y="14.5" fontSize="4.5" fontWeight="bold">3</text>
          <rect x="5" y="12" width="10" height="1.5" rx="0.5" />
        </svg>
      );
    case 'indent':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
          <rect x="5" y="2" width="10" height="1.5" rx="0.5" />
          <rect x="5" y="5.5" width="10" height="1.5" rx="0.5" />
          <rect x="5" y="9" width="10" height="1.5" rx="0.5" />
          <polygon points="1,4 1,10 4,7" />
        </svg>
      );
    case 'outdent':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
          <rect x="5" y="2" width="10" height="1.5" rx="0.5" />
          <rect x="5" y="5.5" width="10" height="1.5" rx="0.5" />
          <rect x="5" y="9" width="10" height="1.5" rx="0.5" />
          <polygon points="4,4 4,10 1,7" />
        </svg>
      );
    case 'hr':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
          <rect x="1" y="7" width="14" height="2" rx="1" />
        </svg>
      );
    case 'table':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.2">
          <rect x="1" y="2" width="14" height="12" rx="1" />
          <line x1="1" y1="6" x2="15" y2="6" />
          <line x1="1" y1="10" x2="15" y2="10" />
          <line x1="6" y1="2" x2="6" y2="14" />
          <line x1="11" y1="2" x2="11" y2="14" />
        </svg>
      );
    case 'undo':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M4 6l-3 3 3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M1 9h9a4 4 0 0 1 0 8H8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    case 'redo':
      return (
        <svg className="w-3.5 h-3.5" viewBox="0 0 16 16" fill="currentColor">
          <path d="M12 6l3 3-3 3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M15 9H6a4 4 0 0 0 0 8h2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
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
      editor.innerHTML = value;
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
        <select
          onChange={(e) => handleHeading(e.target.value)}
          className="px-1.5 py-1 text-xs border border-border rounded bg-card hover:bg-muted mr-1"
          defaultValue="p"
        >
          <option value="p">ย่อหน้า</option>
          <option value="h1">หัวข้อ 1</option>
          <option value="h2">หัวข้อ 2</option>
          <option value="h3">หัวข้อ 3</option>
          <option value="h4">หัวข้อ 4</option>
        </select>

        {/* Font size */}
        <select
          value={fontSize}
          onChange={(e) => handleFontSize(e.target.value)}
          className="px-1.5 py-1 text-xs border border-border rounded bg-card hover:bg-muted mr-1"
        >
          <option value="1">เล็กมาก</option>
          <option value="2">เล็ก</option>
          <option value="3">ปกติ</option>
          <option value="4">ใหญ่</option>
          <option value="5">ใหญ่มาก</option>
          <option value="6">หัวข้อใหญ่</option>
        </select>

        {/* Divider */}
        <div className="w-px h-5 bg-border mx-1" />

        {/* Button groups */}
        {TOOLBAR.map((group, gi) => (
          <div key={gi} className="flex items-center">
            {group.buttons.map((btn) => (
              <button
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
        <button
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
          className="flex-1 px-4 py-3 text-xs font-mono resize-none focus:outline-none"
          style={{ minHeight }}
          spellCheck={false}
        />
      ) : (
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          className="flex-1 px-4 py-3 text-sm focus:outline-none overflow-auto"
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
