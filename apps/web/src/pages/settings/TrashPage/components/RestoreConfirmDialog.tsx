import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { TrashRow } from '@/hooks/useTrash';
import { restoreEffects } from '../trash.util';

export type RestoreTarget = { kind: 'single'; row: TrashRow } | { kind: 'bulk'; rows: TrashRow[] };

interface Props {
  target: RestoreTarget | null;
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** ยืนยันก่อนกู้ — บอกสิ่งที่จะเกิด (ไม่ใช่กล่องแดง) · กู้หลายรายการ = ทีละรายการ รายการที่ล้มไม่หยุดรายการอื่น */
export default function RestoreConfirmDialog({ target, loading, onConfirm, onCancel }: Props) {
  if (!target) return <ConfirmDialog open={false} onOpenChange={() => undefined} description="" onConfirm={onConfirm} />;
  const single = target.kind === 'single';
  const title = single ? `กู้คืน "${target.row.title}"?` : `กู้คืน ${target.rows.length} รายการ?`;
  const effects = single ? restoreEffects(target.row) : ['กู้ทีละรายการ — รายการที่กู้ไม่ได้จะถูกข้ามพร้อมเหตุผล ไม่หยุดรายการอื่น', 'บันทึกในประวัติการดำเนินการทุกรายการที่กู้สำเร็จ'];
  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => { if (!open) onCancel(); }}
      title={title}
      description={single ? `${target.row.typeLabel} · ลบเมื่อก่อนหน้านี้` : target.rows.map((r) => r.title).slice(0, 5).join(' · ') + (target.rows.length > 5 ? ` · และอีก ${target.rows.length - 5} รายการ` : '')}
      confirmLabel="กู้คืน"
      loading={loading}
      closeOnConfirm={false}
      onConfirm={onConfirm}
    >
      <ul className="list-disc space-y-1 pl-5 text-sm leading-snug">
        {effects.map((e) => <li key={e}>{e}</li>)}
      </ul>
    </ConfirmDialog>
  );
}
