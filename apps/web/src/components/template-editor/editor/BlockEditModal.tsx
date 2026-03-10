import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
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

  const addSubItem = () => {
    setForm(prev => ({
      ...prev,
      subItems: [...(prev.subItems || []), ''],
    }));
  };

  const updateSubItem = (index: number, value: string) => {
    setForm(prev => {
      const items = [...(prev.subItems || [])];
      items[index] = value;
      return { ...prev, subItems: items };
    });
  };

  const removeSubItem = (index: number) => {
    setForm(prev => ({
      ...prev,
      subItems: (prev.subItems || []).filter((_, i) => i !== index),
    }));
  };

  // Insert variable into the Tiptap editor at cursor position
  const insertVariable = (key: string) => {
    const tag = `{{= ${key}}}`;
    const editor = editorInstanceRef.current;
    if (editor) {
      editor.chain().focus().insertContent(tag + ' ').run();
      return;
    }
    // Fallback for non-rich-text blocks: append to content
    setForm(prev => ({
      ...prev,
      content: (prev.content || '') + tag,
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
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-800">แก้ไขส่วนประกอบ</h2>
          <button onClick={handleClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        {/* Body - 2 columns */}
        <div className="flex-1 overflow-hidden flex">
          {/* Left: Edit form */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Block type */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">ประเภท</label>
              <select
                value={form.type}
                onChange={e => setForm(prev => ({ ...prev, type: e.target.value as BlockType }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
              >
                {BLOCK_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label} — {t.description}</option>
                ))}
              </select>
            </div>

            {/* Clause fields */}
            {form.type === 'clause' && (
              <div className="grid grid-cols-[100px_1fr] gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">เลขข้อ</label>
                  <input
                    type="number"
                    value={form.clauseNumber || ''}
                    onChange={e => setForm(prev => ({ ...prev, clauseNumber: parseInt(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    min={1}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อข้อสัญญา</label>
                  <input
                    type="text"
                    value={form.clauseTitle || ''}
                    onChange={e => setForm(prev => ({ ...prev, clauseTitle: e.target.value }))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    placeholder="เช่น วัตถุประสงค์และข้อจำกัด"
                  />
                </div>
              </div>
            )}

            {/* Content - Rich Text Editor or textarea */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                เนื้อหา
                <span className="ml-2 text-xs text-gray-400 font-normal">
                  คลิกตัวแปรด้านขวาเพื่อแทรก | จัดรูปแบบด้วย toolbar ด้านบน
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 resize-y"
                />
              )}
            </div>

            {/* Sub-items for clause type */}
            {form.type === 'clause' && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-gray-700">ข้อย่อย</label>
                  <button
                    onClick={addSubItem}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700"
                  >
                    <Plus size={12} /> เพิ่มข้อย่อย
                  </button>
                </div>
                <div className="space-y-2">
                  {(form.subItems || []).map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2">
                      <span className="text-xs text-gray-400 mt-2.5 w-6 text-right">{idx + 1})</span>
                      <textarea
                        value={item}
                        onChange={e => updateSubItem(idx, e.target.value)}
                        className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono resize-y"
                        rows={2}
                      />
                      <button
                        onClick={() => removeSubItem(idx)}
                        className="p-1.5 text-gray-400 hover:text-red-600 mt-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Variable insert panel */}
          {showVarPanel && (
            <div className="w-72 border-l border-gray-200 bg-gray-50 overflow-y-auto">
              <div className="p-3">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-bold text-gray-500 uppercase">แทรกตัวแปร</h3>
                  <span className="text-[10px] text-gray-400">คลิกเพื่อแทรก</span>
                </div>

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
                    <div key={group.label} className="mb-1">
                      <button
                        onClick={() => setExpandedGroup(isExpanded ? null : group.label)}
                        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-xs font-semibold text-gray-600 hover:bg-gray-100 rounded transition-colors"
                      >
                        {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        {group.label}
                        <span className="text-[10px] text-gray-400 ml-auto">{vars.length}</span>
                      </button>
                      {isExpanded && (
                        <div className="ml-1 space-y-0.5 pb-2">
                          {vars.map(v => (
                            <button
                              key={v.key}
                              onClick={() => insertVariable(v.key)}
                              className="w-full flex items-center gap-2 px-2 py-1.5 text-left rounded hover:bg-blue-50 hover:text-blue-700 transition-colors group"
                              title={`ตัวอย่าง: ${v.sampleValue}`}
                            >
                              <span className="text-xs text-gray-700 group-hover:text-blue-700 truncate flex-1">{v.label}</span>
                              <span className="text-[9px] px-1 py-0.5 rounded bg-gray-200 text-gray-500 group-hover:bg-blue-100 group-hover:text-blue-600 shrink-0">
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
                <div className="mt-3 pt-3 border-t border-gray-200">
                  <h4 className="text-[10px] font-bold text-gray-400 uppercase mb-2">ส่วนพิเศษ</h4>
                  <div className="space-y-1">
                    <button
                      onClick={() => insertVariable('SIGN_CUSTOMER')}
                      className="w-full text-left px-2 py-1.5 text-xs text-gray-700 rounded hover:bg-green-50 hover:text-green-700"
                    >
                      ลายเซ็นผู้เช่าซื้อ
                    </button>
                    <button
                      onClick={() => insertVariable('SIGN_COMPANY')}
                      className="w-full text-left px-2 py-1.5 text-xs text-gray-700 rounded hover:bg-green-50 hover:text-green-700"
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
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200">
          <button
            onClick={() => setShowVarPanel(!showVarPanel)}
            className="text-xs text-gray-500 hover:text-blue-600"
          >
            {showVarPanel ? 'ซ่อนตัวแปร' : 'แสดงตัวแปร'}
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              ยกเลิก
            </button>
            <button
              onClick={handleSave}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
            >
              บันทึก
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
