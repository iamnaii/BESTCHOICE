import { useState, useEffect, useRef, useCallback } from 'react';
import { X, ChevronDown, ChevronRight, Variable } from 'lucide-react';
import type { Editor } from '@tiptap/react';
import type { Block, BlockType } from '@/types/template';
import { BLOCK_TYPES } from '@/constants/blockTypes';
import { AVAILABLE_VARIABLES, VARIABLE_GROUPS } from '@/constants/variables';
import { useTemplateStore } from '@/store/templateStore';
import RichTextEditor from './RichTextEditor';

export default function BlockEditModal() {
  const { editingBlock, setEditingBlock, updateBlock } = useTemplateStore();
  const [form, setForm] = useState<Partial<Block>>({});
  const [showVarPanel, setShowVarPanel] = useState(true);
  const [expandedGroup, setExpandedGroup] = useState<string | null>('สัญญา');
  const editorInstanceRef = useRef<Editor | null>(null);

  useEffect(() => {
    if (editingBlock) {
      setForm({
        type: editingBlock.type,
        content: editingBlock.content,
        clauseNumber: editingBlock.clauseNumber,
        clauseTitle: editingBlock.clauseTitle,
        subItems: editingBlock.subItems ? [...editingBlock.subItems] : [],
      });
    }
  }, [editingBlock]);

  if (!editingBlock) return null;

  const handleSave = () => {
    updateBlock(editingBlock.id, form);
    setEditingBlock(null);
  };

  const handleClose = () => setEditingBlock(null);

  // Insert variable into the Tiptap editor at cursor position (bold by default)
  const insertVariable = (key: string) => {
    const tag = `{{= ${key}}}`;
    const editor = editorInstanceRef.current;
    if (editor) {
      // Insert as bold so variables stand out in the document
      editor.chain().focus()
        .toggleBold()
        .insertContent(tag)
        .toggleBold()
        .insertContent(' ')
        .run();
      return;
    }
    // Fallback for non-rich-text blocks: wrap in <strong>
    setForm(prev => ({
      ...prev,
      content: (prev.content || '') + `<strong>${tag}</strong>`,
    }));
  };

  // Callback when Tiptap editor is ready
  const handleEditorReady = useCallback((editor: Editor) => {
    editorInstanceRef.current = editor;
  }, []);

  // Use functional updater to avoid stale closure
  const handleContentChange = useCallback((content: string) => {
    setForm(prev => ({ ...prev, content }));
  }, []);

  // Check if this block type should use rich text editor
  const useRichText = !['payment-table', 'signature-block', 'photo-attachment'].includes(form.type || '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-800">แก้ไขส่วนประกอบ</h2>
          <button onClick={handleClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body - 2 columns */}
        <div className="flex-1 overflow-hidden flex">
          {/* Left: Edit form */}
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* Block type */}
            <div>
              <label className="block text-base font-semibold text-gray-700 mb-1.5">ประเภท</label>
              <select
                value={form.type}
                onChange={e => setForm(prev => ({ ...prev, type: e.target.value as BlockType }))}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              >
                {BLOCK_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label} — {t.description}</option>
                ))}
              </select>
            </div>

            {/* Clause fields */}
            {form.type === 'clause' && (
              <div className="flex gap-4">
                <div className="w-28">
                  <label className="block text-base font-semibold text-gray-700 mb-1.5">เลขข้อ</label>
                  <input
                    type="number"
                    value={form.clauseNumber || ''}
                    onChange={e => setForm(prev => ({ ...prev, clauseNumber: parseInt(e.target.value) || 0 }))}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-primary-500"
                    min={1}
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-base font-semibold text-gray-700 mb-1.5">ชื่อข้อสัญญา</label>
                  <input
                    type="text"
                    value={form.clauseTitle || ''}
                    onChange={e => setForm(prev => ({ ...prev, clauseTitle: e.target.value }))}
                    className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-base focus:ring-2 focus:ring-primary-500"
                    placeholder="เช่น วัตถุประสงค์และข้อจำกัด"
                  />
                </div>
              </div>
            )}

            {/* Content - Rich Text Editor or textarea */}
            <div>
              <label className="block text-base font-semibold text-gray-700 mb-1.5">
                เนื้อหา
                <span className="ml-2 text-sm text-gray-400 font-normal">
                  คลิกตัวแปรด้านขวาเพื่อแทรก
                </span>
              </label>
              {useRichText ? (
                <RichTextEditor
                  value={form.content || ''}
                  onChange={handleContentChange}
                  onEditorReady={handleEditorReady}
                  placeholder="พิมพ์เนื้อหา... ใช้ toolbar จัดรูปแบบ หรือคลิกตัวแปรด้านขวาเพื่อแทรก"
                />
              ) : (
                <textarea
                  value={form.content || ''}
                  onChange={e => setForm(prev => ({ ...prev, content: e.target.value }))}
                  placeholder="เนื้อหาสำหรับ block นี้..."
                  rows={6}
                  className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-base font-mono focus:ring-2 focus:ring-primary-500 resize-y"
                />
              )}
            </div>

          </div>

          {/* Right: Variable insert panel */}
          {showVarPanel && (
            <div className="w-80 border-l border-gray-200 bg-gray-50 overflow-y-auto flex flex-col">
              {/* Panel header */}
              <div className="sticky top-0 z-10 bg-gray-50 border-b border-gray-200 px-4 py-3 flex items-center gap-2">
                <Variable size={16} className="text-primary-600" />
                <h3 className="text-base font-bold text-gray-600">แทรกตัวแปร</h3>
                <span className="text-sm text-gray-400 ml-auto">คลิกเพื่อแทรก</span>
              </div>

              <div className="p-3 space-y-1">
                {VARIABLE_GROUPS.map(group => {
                  const vars = AVAILABLE_VARIABLES.filter(v => {
                    if (v.type === 'array') return false;
                    if (group.altPrefix) {
                      return v.key.startsWith(group.prefix) || v.key.startsWith(group.altPrefix);
                    }
                    return v.key.startsWith(group.prefix);
                  });
                  if (vars.length === 0) return null;
                  const isExpanded = expandedGroup === group.label;

                  return (
                    <div key={group.label}>
                      <button
                        onClick={() => setExpandedGroup(isExpanded ? null : group.label)}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-base font-semibold text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                      >
                        {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        {group.label}
                        <span className="text-sm text-gray-400 ml-auto bg-gray-200 px-1.5 py-0.5 rounded-full">{vars.length}</span>
                      </button>
                      {isExpanded && (
                        <div className="ml-2 space-y-0.5 pb-2 pt-1">
                          {vars.map(v => (
                            <button
                              key={v.key}
                              onClick={() => insertVariable(v.key)}
                              className="w-full flex items-center gap-2 px-3 py-2 text-left rounded-lg hover:bg-primary-50 hover:text-primary-700 transition-colors group"
                              title={`ตัวอย่าง: ${v.sampleValue}`}
                            >
                              <span className="text-base text-gray-700 group-hover:text-primary-700 truncate flex-1">{v.label}</span>
                              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-200 text-gray-500 group-hover:bg-primary-100 group-hover:text-primary-600 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                                แทรก
                              </span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Special blocks */}
                <div className="mt-2 pt-3 border-t border-gray-200">
                  <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2 px-3">ส่วนพิเศษ</h4>
                  <div className="space-y-0.5">
                    <button
                      onClick={() => insertVariable('SIGN_CUSTOMER')}
                      className="w-full text-left px-3 py-2 text-base text-gray-700 rounded-lg hover:bg-green-50 hover:text-green-700 transition-colors"
                    >
                      ลายเซ็นผู้เช่าซื้อ
                    </button>
                    <button
                      onClick={() => insertVariable('SIGN_COMPANY')}
                      className="w-full text-left px-3 py-2 text-base text-gray-700 rounded-lg hover:bg-green-50 hover:text-green-700 transition-colors"
                    >
                      ลายเซ็นผู้ให้เช่าซื้อ
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">
          <button
            onClick={() => setShowVarPanel(!showVarPanel)}
            className="flex items-center gap-1.5 text-base text-gray-500 hover:text-primary-600 transition-colors"
          >
            <Variable size={16} />
            {showVarPanel ? 'ซ่อนตัวแปร' : 'แสดงตัวแปร'}
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={handleClose}
              className="px-5 py-2.5 text-base font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
            >
              ยกเลิก
            </button>
            <button
              onClick={handleSave}
              className="px-5 py-2.5 text-base font-medium bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition-colors"
            >
              บันทึก
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
