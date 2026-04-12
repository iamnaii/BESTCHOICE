import { UseMutationResult } from '@tanstack/react-query';
import Modal from '@/components/ui/Modal';
import { StockProduct } from '../types';

export interface BulkTransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedIds: Set<string>;
  listProducts: StockProduct[];
  branches: { id: string; name: string }[];
  transferBranchId: string;
  setTransferBranchId: (id: string) => void;
  transferNotes: string;
  setTransferNotes: (notes: string) => void;
  bulkTransferMutation: UseMutationResult<unknown, unknown, { productIds: string[]; toBranchId: string; notes?: string }>;
  onSubmit: (e: React.FormEvent) => void;
}

export function BulkTransferModal({
  isOpen,
  onClose,
  selectedIds,
  listProducts,
  branches,
  transferBranchId,
  setTransferBranchId,
  transferNotes,
  setTransferNotes,
  bulkTransferMutation,
  onSubmit,
}: BulkTransferModalProps) {
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`โอนสินค้า ${selectedIds.size} รายการ`}
      size="sm"
    >
      <form onSubmit={onSubmit} className="space-y-4">
        {/* Selected items summary */}
        <div className="bg-muted/60 rounded-xl p-3.5 max-h-48 overflow-y-auto border border-border/40">
          <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">สินค้าที่เลือก:</div>
          <div className="space-y-1">
            {listProducts.filter(p => selectedIds.has(p.id)).map(p => (
              <div key={p.id} className="flex items-center justify-between text-sm">
                <span className="text-foreground">{p.brand} {p.model}</span>
                <span className="text-xs text-muted-foreground font-mono">{p.imeiSerial || '-'}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Destination branch */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">สาขาปลายทาง</label>
          <select
            value={transferBranchId}
            onChange={(e) => setTransferBranchId(e.target.value)}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
            required
          >
            <option value="">เลือกสาขา...</option>
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">หมายเหตุ (ไม่บังคับ)</label>
          <textarea
            value={transferNotes}
            onChange={(e) => setTransferNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden resize-none"
            placeholder="เช่น ส่งไปเปิดสาขาใหม่..."
          />
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-muted-foreground hover:text-foreground border border-input rounded-lg"
          >
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={bulkTransferMutation.isPending || !transferBranchId}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {bulkTransferMutation.isPending ? 'กำลังโอน...' : `โอน ${selectedIds.size} รายการ`}
          </button>
        </div>
      </form>
    </Modal>
  );
}
