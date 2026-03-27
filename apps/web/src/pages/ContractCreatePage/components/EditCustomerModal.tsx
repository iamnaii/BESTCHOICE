import React from 'react';
import Modal from '@/components/ui/Modal';
import type { UseMutationResult } from '@tanstack/react-query';

export interface EditCustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  editCustForm: Record<string, any>;
  setEditCustForm: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  editCustomerMutation: UseMutationResult<any, unknown, void, unknown>;
}

export function EditCustomerModal({
  isOpen,
  onClose,
  editCustForm,
  setEditCustForm,
  editCustomerMutation,
}: EditCustomerModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="แก้ไขข้อมูลลูกค้า">
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">ชื่อ-นามสกุล</label>
          <input type="text" value={editCustForm.name || ''} onChange={(e) => setEditCustForm({ ...editCustForm, name: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs text-muted-foreground mb-1">เบอร์โทร</label>
          <input type="tel" value={editCustForm.phone || ''} onChange={(e) => setEditCustForm({ ...editCustForm, phone: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
        </div>
        <div className="flex justify-end gap-3 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground border border-input rounded-lg">ยกเลิก</button>
          <button type="button" onClick={() => editCustomerMutation.mutate()} disabled={editCustomerMutation.isPending} className="px-6 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium disabled:opacity-50">
            {editCustomerMutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
