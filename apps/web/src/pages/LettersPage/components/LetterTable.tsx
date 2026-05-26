import { Eye, Truck, X, Check, AlertTriangle, Undo2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import type { LetterRow, LetterStatus } from '../types';

interface Props {
  rows: LetterRow[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: (checked: boolean) => void;
  status: LetterStatus;
  canCancel: boolean;
  onPreview: (row: LetterRow) => void;
  onDispatch: (row: LetterRow) => void;
  onMarkDelivered: (row: LetterRow) => void;
  onMarkUndeliverable: (row: LetterRow) => void;
  onRevertUndeliverable: (row: LetterRow) => void;
  onCancel: (row: LetterRow) => void;
}

const LETTER_TYPE_TH: Record<string, string> = {
  RETURN_DEVICE_45D: 'เก็บอุปกรณ์ 45ว',
  CONTRACT_TERMINATION_60D: 'บอกเลิก 60ว',
};

const formatBkk = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit' }) : '-';

export default function LetterTable({
  rows,
  selectedIds,
  onToggle,
  onToggleAll,
  status,
  canCancel,
  onPreview,
  onDispatch,
  onMarkDelivered,
  onMarkUndeliverable,
  onRevertUndeliverable,
  onCancel,
}: Props) {
  const allChecked = rows.length > 0 && rows.every((r) => selectedIds.has(r.id));
  const hasCheckbox = status !== 'CANCELLED' && status !== 'DELIVERED';

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted text-muted-foreground">
          <tr>
            {hasCheckbox && (
              <th className="w-10 p-3">
                <Checkbox checked={allChecked} onCheckedChange={(c) => onToggleAll(!!c)} />
              </th>
            )}
            <th className="p-3 text-left">เลขจดหมาย</th>
            <th className="p-3 text-left">ลูกค้า</th>
            <th className="p-3 text-left">สัญญา</th>
            <th className="p-3 text-left">ประเภท</th>
            <th className="p-3 text-left">วันที่</th>
            {status === 'DISPATCHED' && <th className="p-3 text-left">Tracking</th>}
            <th className="p-3 text-right">Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={8} className="p-8 text-center text-muted-foreground">
                ไม่พบจดหมายในสถานะนี้
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr key={r.id} className="border-t border-border hover:bg-accent/30">
                {hasCheckbox && (
                  <td className="p-3">
                    <Checkbox
                      checked={selectedIds.has(r.id)}
                      onCheckedChange={() => onToggle(r.id)}
                    />
                  </td>
                )}
                <td className="p-3 font-mono">{r.letterNumber}</td>
                <td className="p-3">{r.contract.customer.name}</td>
                <td className="p-3 font-mono text-muted-foreground">{r.contract.contractNumber}</td>
                <td className="p-3">{LETTER_TYPE_TH[r.letterType] ?? r.letterType}</td>
                <td className="p-3">{formatBkk(r.triggeredAt)}</td>
                {status === 'DISPATCHED' && (
                  <td className="p-3 font-mono text-xs">{r.trackingNumber ?? '-'}</td>
                )}
                <td className="p-3 text-right">
                  <div className="inline-flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => onPreview(r)}>
                      <Eye className="size-4" />
                    </Button>
                    {status === 'PDF_GENERATED' && (
                      <Button size="sm" variant="outline" onClick={() => onDispatch(r)}>
                        <Truck className="size-4 mr-1" /> ส่ง
                      </Button>
                    )}
                    {status === 'DISPATCHED' && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => onMarkDelivered(r)}>
                          <Check className="size-4 mr-1" /> รับแล้ว
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => onMarkUndeliverable(r)}>
                          <AlertTriangle className="size-4" />
                        </Button>
                      </>
                    )}
                    {status === 'UNDELIVERABLE' && (
                      <Button size="sm" variant="outline" onClick={() => onRevertUndeliverable(r)}>
                        <Undo2 className="size-4 mr-1" /> ย้อน
                      </Button>
                    )}
                    {canCancel && (status === 'PENDING_DISPATCH' || status === 'PDF_GENERATED') && (
                      <Button size="sm" variant="ghost" onClick={() => onCancel(r)}>
                        <X className="size-4" />
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
