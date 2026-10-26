import { Link } from 'react-router';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RecurringBillRow } from '@/hooks/useRecurringBills';
import { formatNumberDecimal } from '@/utils/formatters';
import { StatusBadge } from './StatusBadge';
import { PENDING_FAMILY, docStatusLabel, dueDetail, fmtDateTh, isLiveDocument, recurrenceLabel, statusDetail } from './labels';

export interface BillsTableProps {
  rows: RecurringBillRow[];
  /** งวดที่กำลังยิง API — ปุ่มของแถวนั้นถูกปิดชั่วคราว */
  busyId: string | null;
  onMarkPaid: (row: RecurringBillRow) => void;
  onSkip: (row: RecurringBillRow) => void;
  onReopen: (row: RecurringBillRow) => void;
  onCreateDraft: (row: RecurringBillRow) => void;
  onEditBill: (row: RecurringBillRow) => void;
}

const linkBtn = 'inline-flex h-7 items-center rounded-md border border-input bg-background px-2.5 text-xs font-medium text-foreground hover:bg-accent max-lg:min-h-11';
const th = 'px-3 py-2 text-left text-xs font-medium text-muted-foreground';

export function BillsTable({ rows, busyId, onMarkPaid, onSkip, onReopen, onCreateDraft, onEditBill }: BillsTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-card">
      <table className="w-full min-w-[960px] text-sm">
        <thead className="bg-muted/50">
          <tr>
            <th className={th}>บิล / ผู้รับเงิน</th>
            <th className={th}>สาขา</th>
            <th className={th}>ครบกำหนด</th>
            <th className={`${th} text-right`}>ยอดประมาณ</th>
            <th className={th}>สถานะ</th>
            <th className={th}>ร่าง / ใบรายจ่าย</th>
            <th className={`${th} text-right`}>การทำ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <BillRow
              key={row.occurrenceId ?? `projected:${row.templateId}:${row.periodKey}`}
              row={row}
              busy={busyId != null && busyId === row.occurrenceId}
              onMarkPaid={onMarkPaid}
              onSkip={onSkip}
              onReopen={onReopen}
              onCreateDraft={onCreateDraft}
              onEditBill={onEditBill}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BillRow({ row, busy, onMarkPaid, onSkip, onReopen, onCreateDraft, onEditBill }: Omit<BillsTableProps, 'rows' | 'busyId'> & { row: RecurringBillRow; busy: boolean }) {
  const doc = row.document;
  const liveDoc = isLiveDocument(doc);
  const pendingFamily = PENDING_FAMILY.has(row.status);
  const needsPayment = !row.paymentConfigured && (row.status === 'UPCOMING' || pendingFamily);
  const openDraft = liveDoc ? (
    <Link to={`/expenses/${doc.id}`} className={linkBtn}>{row.status === 'PAID' ? 'ดูใบ' : 'เปิดร่าง'}</Link>
  ) : null;
  // ร่างหาย (ถูกลบ/ยกเลิก/สร้างไม่สำเร็จ) และแม่แบบยังอยู่ → สร้างใหม่ได้ (แม่แบบถูกลบ = API ตอบ 409 จึงไม่โชว์ปุ่ม)
  const recreate = !liveDoc && !row.templateDeleted && row.occurrenceId ? (
    <Button variant="outline" size="sm" disabled={busy} onClick={() => onCreateDraft(row)}>สร้างร่างใหม่</Button>
  ) : null;

  let actions: React.ReactNode;
  switch (row.status) {
    case 'UPCOMING':
      actions = <Button variant="outline" size="sm" onClick={() => onEditBill(row)}>แก้ไขบิล</Button>;
      break;
    case 'PENDING':
    case 'DUE_TODAY':
    case 'OVERDUE':
      actions = (
        <>
          {openDraft ?? recreate}
          <Button variant="primary" size="sm" disabled={busy} onClick={() => onMarkPaid(row)}>จ่ายแล้ว</Button>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onSkip(row)}>ข้าม</Button>
        </>
      );
      break;
    case 'PAID_UNPOSTED':
      actions = (
        <>
          {openDraft ?? recreate}
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onReopen(row)}>เปิดใหม่</Button>
        </>
      );
      break;
    case 'PAID':
      actions = openDraft;
      break;
    case 'SKIPPED':
      actions = (
        <>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => onReopen(row)}>เปิดใหม่</Button>
          {/* ระบบข้ามเอง (งวดหลุด): ถ้าจ่ายไปแล้วนอกระบบ กดครั้งเดียว = เปิดใหม่ + บันทึกจ่าย */}
          {row.skippedByName == null && (
            <Button variant="primary" size="sm" disabled={busy} onClick={() => onMarkPaid(row)}>จ่ายแล้ว</Button>
          )}
        </>
      );
      break;
  }

  return (
    <tr aria-label={row.templateName} className="align-top">
      <td className="px-3 py-2">
        <div className="font-medium text-foreground">
          {row.templateName}
          {row.templateDeleted && (
            <span className="ml-1.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[11px] font-normal text-muted-foreground">แม่แบบถูกลบ</span>
          )}
        </div>
        <div className="text-xs text-muted-foreground">{row.vendorName ?? '—'} · {recurrenceLabel(row)}</div>
      </td>
      <td className="px-3 py-2 text-foreground">{row.branch.name}</td>
      <td className="px-3 py-2">
        <div className="text-foreground">{fmtDateTh(row.dueDate)}</div>
        <div className={`text-xs ${row.status === 'OVERDUE' ? 'text-destructive' : row.status === 'DUE_TODAY' ? 'text-warning-strong' : 'text-muted-foreground'}`}>{dueDetail(row)}</div>
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-foreground">{row.expectedAmount ? formatNumberDecimal(row.expectedAmount) : '—'}</td>
      <td className="px-3 py-2">
        <StatusBadge row={row} />
        <div className="mt-1 max-w-[260px] text-xs text-muted-foreground">
          <span>{statusDetail(row)}</span>
        </div>
      </td>
      <td className="px-3 py-2" data-testid="bill-document">
        {doc && (doc.deletedAt
          ? <div className="font-mono text-xs text-muted-foreground line-through">{doc.number}</div>
          : <Link to={`/expenses/${doc.id}`} className="font-mono text-xs text-primary hover:underline">{doc.number}</Link>)}
        <div className="text-xs text-muted-foreground">{docStatusLabel(row)}</div>
        {doc?.deletedAt && <div className="text-xs text-muted-foreground">ถูกลบ {fmtDateTh(doc.deletedAt)}</div>}
        {needsPayment && (
          <div className="mt-0.5 flex items-center gap-1 text-xs text-warning-strong">
            <TriangleAlert className="size-3" aria-hidden="true" />ยังไม่ตั้งวิธีจ่าย
          </div>
        )}
      </td>
      <td className="px-3 py-2" data-testid="bill-actions">
        <div className="flex flex-wrap items-center justify-end gap-1.5">{actions}</div>
      </td>
    </tr>
  );
}
