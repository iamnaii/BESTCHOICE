import React from 'react';
import Modal from '@/components/ui/Modal';
import type { UseMutationResult } from '@tanstack/react-query';

export interface EditProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  editProductForm: Record<string, any>;
  setEditProductForm: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  editProductMutation: UseMutationResult<any, unknown, void, unknown>;
}

export function EditProductModal({
  isOpen,
  onClose,
  editProductForm,
  setEditProductForm,
  editProductMutation,
}: EditProductModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="แก้ไขข้อมูลสินค้า">
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">ชื่อสินค้า</label>
          <input type="text" value={editProductForm.name || ''} onChange={(e) => setEditProductForm({ ...editProductForm, name: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">ยี่ห้อ</label>
            <input type="text" value={editProductForm.brand || ''} onChange={(e) => setEditProductForm({ ...editProductForm, brand: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">รุ่น</label>
            <input type="text" value={editProductForm.model || ''} onChange={(e) => setEditProductForm({ ...editProductForm, model: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground border border-input rounded-lg">ยกเลิก</button>
          <button type="button" onClick={() => editProductMutation.mutate()} disabled={editProductMutation.isPending} className="px-6 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50">
            {editProductMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
