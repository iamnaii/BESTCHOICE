import { Lock, LockOpen, Phone, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { contractStatusMap, getStatusBadgeProps } from '@/lib/status-badges';
import { cn } from '@/lib/utils';
import { formatDateShort } from '@/utils/formatters';
import type { ContractProgress } from '../types';
import { CALL_RESULT_LABELS } from '../utils/callResultLabels';

const baht = (n: number) => `${n.toLocaleString('th-TH', { maximumFractionDigits: 2 })} ฿`;

function Stat({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className={cn('min-w-0 rounded-lg px-2.5 py-2', danger ? 'bg-destructive/5' : 'bg-muted/50')}>
      <div className="truncate text-[11.5px] leading-snug text-muted-foreground">{label}</div>
      <div className={cn('truncate text-sm font-bold leading-snug tabular-nums', danger && 'text-destructive')}>{value}</div>
    </div>
  );
}

export default function ActiveContractCard({ contract }: { contract: ContractProgress }) {
  const navigate = useNavigate();
  const status = getStatusBadgeProps(contract.status, contractStatusMap);
  const total = contract.totalInstallments;
  const pct = total > 0 ? Math.round((contract.paidInstallments / total) * 100) : 0;
  const latePct = total > 0 ? Math.round((contract.overdueInstallments / total) * 100) : 0;
  const warrantyEnd = contract.shopWarrantyEndDate ?? contract.centerWarrantyEndDate;
  const warrantyLabel = contract.shopWarrantyEndDate ? 'ประกันร้านถึง' : 'ประกันศูนย์ถึง';
  const meta = [
    <>สัญญา <span className="font-mono tabular-nums">{contract.contractNumber}</span></>,
    `เริ่ม ${formatDateShort(contract.startedAt)}`,
    `${total} งวด`,
    contract.branchName,
    contract.imeiSerial && <>IMEI <span className="font-mono tabular-nums">{contract.imeiSerial}</span></>,
  ].filter(Boolean);

  return (
    <div data-testid={`active-contract-${contract.id}`} className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[15px] font-bold leading-snug">{contract.productLabel || contract.contractNumber}</span>
            <Badge variant={status.variant} appearance={status.appearance} size="sm">{status.label}</Badge>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-1.5 text-xs leading-snug text-muted-foreground">
            {meta.map((item, i) => (
              <span key={i} className="whitespace-nowrap">{i > 0 && '· '}{item}</span>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 gap-1.5">
          {/* R6: /payments อ่านแค่ ?search= (ไม่มีที่ไหนอ่าน ?contractId=) — ไปหน้าชำระด้วยเลขที่สัญญา */}
          <Button variant="primary" size="sm" onClick={() => navigate(`/payments?search=${encodeURIComponent(contract.contractNumber)}`)}>รับชำระ</Button>
          <Button variant="outline" size="sm" onClick={() => navigate(`/contracts/${contract.id}`)}>ดูสัญญา</Button>
        </div>
      </div>

      <div className="mt-3.5">
        <div className="mb-1.5 flex justify-between text-xs leading-snug">
          <span>ผ่อนแล้ว {contract.paidInstallments}/{total} งวด</span>
          <span className="tabular-nums text-muted-foreground">{pct}%</span>
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={contract.paidInstallments} aria-valuemin={0} aria-valuemax={total}>
          <i className="block h-full bg-success" style={{ width: `${pct}%` }} />
          {latePct > 0 && <i className="block h-full bg-destructive" style={{ width: `${latePct}%` }} />}
        </div>
      </div>

      {/* R8 real-screen measurement (1280×900): 4 คอลัมน์ตรงกับ index.tsx ที่กางแผงข้าง
          360px ที่ xl (1280px) เหมือนกัน ทำให้คอลัมน์ "เหลือ" โดนตัด — คืนเป็น 2 คอลัมน์
          เฉพาะช่วง xl-2xl แล้วค่อยกลับไป 4 คอลัมน์ตอน 2xl (1536px) ที่กว้างพอ */}
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
        <Stat label="งวดละ" value={baht(contract.monthlyPayment)} />
        <Stat label="เหลือ" value={`${contract.remainingInstallments} งวด · ${baht(contract.outstanding)}`} />
        <Stat
          label="ค้างชำระ"
          value={contract.overdueInstallments > 0 && contract.firstOverdueInstallmentNo !== null ? `งวด ${contract.firstOverdueInstallmentNo} · ${baht(contract.overdueAmount)}` : 'ไม่มี'}
          danger={contract.overdueInstallments > 0}
        />
        <Stat label="งวดถัดไป" value={contract.nextDueDate ? formatDateShort(contract.nextDueDate) : '—'} />
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs leading-snug text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          {contract.mdmLocked ? <Lock className="size-3.5" aria-hidden="true" /> : <LockOpen className="size-3.5" aria-hidden="true" />}
          ล็อคเครื่อง (MDM): {contract.mdmLocked ? 'ล็อคแล้ว' : 'ยังไม่ล็อค'}
        </span>
        {warrantyEnd && (
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3.5" aria-hidden="true" />{warrantyLabel} {formatDateShort(warrantyEnd)}
          </span>
        )}
        {contract.lastCall && (
          <span className="inline-flex items-center gap-1.5">
            <Phone className="size-3.5" aria-hidden="true" />
            โทรล่าสุด {formatDateShort(contract.lastCall.calledAt)} · {CALL_RESULT_LABELS[contract.lastCall.result] ?? contract.lastCall.result}
            {contract.lastCall.callerName && ` · ${contract.lastCall.callerName}`}
          </span>
        )}
      </div>
    </div>
  );
}
