import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import BundleSearch, { type BundleProduct } from '@/components/bundle/BundleSearch';

/** แถวของแถมตามที่ `GET /contracts/:id` คืนใน `bundleProducts` */
export interface ContractBundleRow extends BundleProduct {
  status: string;
  deletedAt?: string | null;
}

interface Props {
  contractId: string;
  contractStatus: string;
  branchId: string;
  mainProductId: string;
  bundleProducts: ContractBundleRow[];
  /** ผู้ใช้มีสิทธิ์แก้ (OWNER / BM สาขานี้ / SALES เจ้าของสัญญา) — เซิร์ฟเวอร์ตรวจซ้ำ */
  canEdit: boolean;
  onSaved?: () => void;
}

const CHIP: Record<string, { label: string; className: string }> = {
  RESERVED: { label: 'จองไว้', className: 'bg-warning/10 text-warning' },
  SOLD_CASH: { label: 'ตัดสต๊อกแล้ว', className: 'bg-primary/10 text-primary' },
  IN_STOCK: { label: 'คืนเข้าคลังแล้ว', className: 'bg-muted text-muted-foreground' },
};

/**
 * การ์ด "ของแถม" หน้ารายละเอียดสัญญา — ของแถมเดินตามเครื่องหลัก: ร่าง = จองไว้ · เปิดใช้ = ตัดสต๊อก ·
 * ลบร่าง/ยกเลิก = คืนเข้าคลัง. แก้ไขได้จนกว่าจะเปิดใช้ (PATCH /contracts/:id/bundles)
 * เพราะทางเลือกอื่นของพนักงานที่ลืมใส่คือลบร่างแล้วสร้างใหม่ ซึ่งเสียสิทธิ์อนุมัติเครดิตที่ใช้ไปแล้ว
 */
export default function ContractBundlesCard({
  contractId, contractStatus, branchId, mainProductId, bundleProducts, canEdit, onSaved,
}: Props) {
  const isDraft = contractStatus === 'DRAFT';
  const editable = isDraft && canEdit;
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [working, setWorking] = useState<BundleProduct[]>([]);

  const saveMutation = useMutation({
    mutationFn: async () => api.patch(`/contracts/${contractId}/bundles`, { bundleProductIds: working.map((p) => p.id) }),
    onSuccess: () => {
      toast.success('บันทึกของแถมแล้ว');
      setOpen(false);
      onSaved?.();
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  if (!bundleProducts.length && !editable) return null;

  const startEdit = () => { setWorking(bundleProducts); setSearch(''); setOpen(true); };
  const footnote = isDraft
    ? 'เพิ่ม/นำออกได้จนกว่าจะเปิดใช้สัญญา'
    : contractStatus === 'CANCELED'
      ? 'กลับเป็นพร้อมขายพร้อมเครื่องหลัก'
      : 'ต้นทุนของแถมลงบัญชีหน้าร้านแล้ว · แก้ไขไม่ได้';

  return (
    <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3 mb-3 min-h-11">
        <h2 className="text-lg font-semibold text-foreground">ของแถม</h2>
        {editable && (
          <button type="button" onClick={startEdit} className="min-h-11 px-3 text-sm font-semibold text-primary hover:underline">
            {bundleProducts.length ? 'แก้ไข' : 'เพิ่มของแถม'}
          </button>
        )}
      </div>

      {bundleProducts.length === 0 ? (
        <p className="text-sm text-muted-foreground leading-snug">สัญญานี้ยังไม่มีของแถม</p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {bundleProducts.map((p) => {
            const chip = p.deletedAt
              ? { label: 'สินค้าถูกลบ', className: 'bg-destructive/10 text-destructive' }
              : CHIP[p.status] ?? { label: 'ตรวจที่หน้าสินค้า', className: 'bg-muted text-muted-foreground' };
            return (
              <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
                <span className="leading-snug">{p.name}</span>
                <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold leading-snug ${chip.className}`}>{chip.label}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 border-t border-border/60 pt-2.5 text-xs text-muted-foreground leading-snug">{footnote}</p>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="แก้ไขของแถม" size="lg">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground leading-snug">
            ของแถมราคา 0 บาท ไม่กระทบยอดในสัญญา — ของที่เพิ่มจะถูกจองทันที ของที่นำออกจะกลับเป็นพร้อมขาย
          </p>
          <BundleSearch
            framed={false}
            bundleSearch={search}
            setBundleSearch={setSearch}
            bundleProducts={working}
            excludeIds={[...working.map((p) => p.id), mainProductId]}
            onAddBundle={(p) => { setWorking((prev) => (prev.some((x) => x.id === p.id) ? prev : [...prev, p])); setSearch(''); }}
            onRemoveBundle={(id) => setWorking((prev) => prev.filter((p) => p.id !== id))}
            branchId={branchId}
            disabled={saveMutation.isPending}
            searchLabel="ค้นหาของแถมเพิ่ม (เฉพาะอุปกรณ์เสริมของสาขานี้)"
          />
          <div className="flex justify-end gap-3 border-t border-border/60 pt-4">
            <button type="button" onClick={() => setOpen(false)} disabled={saveMutation.isPending}
              className="min-h-11 px-4 rounded-lg border border-input text-sm font-medium text-foreground hover:bg-accent">
              ยกเลิก
            </button>
            <button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
              className="min-h-11 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60">
              {saveMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกของแถม'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
