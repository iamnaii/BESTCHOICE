import { useState, useEffect } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import type { Block, BlockType } from '@/types/template';
import { BLOCK_TYPES } from '@/constants/blockTypes';
import { useTemplateStore } from '@/store/templateStore';
import VariableAutocomplete from './VariableAutocomplete';

export default function BlockEditModal() {
  const { editingBlock, setEditingBlock, updateBlock } = useTemplateStore();
  const [form, setForm] = useState<Partial<Block>>({});

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-800">แก้ไข Block</h2>
          <button onClick={handleClose} className="p-1 text-gray-400 hover:text-gray-600">
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {/* Block type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">ประเภท</label>
            <select
              value={form.type}
              onChange={e => setForm({ ...form, type: e.target.value as BlockType })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-violet-500"
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
                  onChange={e => setForm({ ...form, clauseNumber: parseInt(e.target.value) || 0 })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  min={1}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ชื่อข้อสัญญา</label>
                <input
                  type="text"
                  value={form.clauseTitle || ''}
                  onChange={e => setForm({ ...form, clauseTitle: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="เช่น วัตถุประสงค์และข้อจำกัด"
                />
              </div>
            </div>
          )}

          {/* Content */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              เนื้อหา
              <span className="ml-2 text-xs text-gray-400 font-normal">
                พิมพ์ {'{{ '} เพื่อเลือก variable, ใช้ **text** เพื่อ bold
              </span>
            </label>
            <VariableAutocomplete
              value={form.content || ''}
              onChange={content => setForm({ ...form, content })}
              placeholder="พิมพ์เนื้อหา... ใช้ {{= VARIABLE}} สำหรับตัวแปร"
              rows={10}
            />
          </div>

          {/* Sub-items for clause type */}
          {form.type === 'clause' && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">ข้อย่อย</label>
                <button
                  onClick={addSubItem}
                  className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-700"
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

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-200">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleSave}
            className="px-4 py-2 text-sm bg-violet-600 text-white rounded-lg hover:bg-violet-700"
          >
            บันทึก
          </button>
        </div>
      </div>
    </div>
  );
}
