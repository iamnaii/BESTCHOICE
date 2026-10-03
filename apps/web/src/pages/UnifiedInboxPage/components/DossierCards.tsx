import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { AlertTriangle, Copy, Phone, Wrench } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { Group } from './RoomDossier';

// บทบาทที่เปิดปุ่ม "แจ้งปัญหาเครื่อง" — ต้องตรงกับ roles ของ route /after-sales/new (App.tsx)
// และ @Roles(...STAFF) ของ POST /after-sales (after-sales.controller.ts) กันเปิดหน้าแล้วชน
// ProtectedRoute "ไม่มีสิทธิ์เข้าถึง" (เช่น FINANCE_MANAGER เข้า /inbox ได้แต่เข้า /after-sales/new ไม่ได้)
const AFTER_SALES_STAFF_ROLES = ['OWNER', 'BRANCH_MANAGER', 'SALES'];

/**
 * การ์ดในแท็บ "สัญญา/ชำระ" และ "ประกัน" ของแผงขวา — ออกแบบตาม mockup ที่เจ้าของเคาะ 2026-09-06:
 * สัญญาเป็นตัวเอก (รุ่นเป็นหัว · แถบความคืบหน้า · งวดละ/เหลือ/ค้าง · ครบกำหนด · รับชำระ) ·
 * ค่างวดเป็นไทม์ไลน์มีจุดสถานะ · สายโทรเอา "ผล" เป็นหัว · เครื่องต่อใบ: IMEI คัดลอกได้ + ประกัน 2 ชั้นเป็นแถบเวลา
 * ข้อมูลทั้งหมดจาก GET /customers/:id/chat-summary (customer-analytics.service) — ไม่มี API ใหม่
 */

export interface SummaryContract {
  id: string;
  contractNumber: string;
  status: string;
  product?: { name?: string; brand?: string; model?: string; serialNumber?: string | null; warrantyExpireDate?: string | null } | null;
  serialNumber?: string | null;
  paidInstallments: number;
  totalInstallments: number;
  monthlyPayment: number | string;
  nextDueDate?: string | null;
  mdmLockedAt?: string | null;
  shopWarrantyEndDate?: string | null;
  deviceReceivedAt?: string | null;
  createdAt?: string | null;
}
export interface SummaryPayment {
  id: string;
  contract?: { contractNumber: string };
  installmentNo: number;
  amountDue: number | string;
  amountPaid: number | string;
  status: string;
  dueDate?: string | null;
  partials: { id: string; receiptNumber: string; amount: number | string; paidDate: string; paymentMethod: string | null }[];
}
export interface SummaryCallLog {
  id: string;
  caller?: { name: string } | null;
  calledAt: string;
  result?: string | null;
  notes?: string | null;
}

const num = (v: number | string | null | undefined) => (v == null ? 0 : typeof v === 'number' ? v : Number(v) || 0);
const baht = (v: number | string | null | undefined) => '฿' + num(v).toLocaleString('th-TH', { maximumFractionDigits: 0 });
const dmy = (iso?: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: '2-digit' });
};
const daysFromNow = (iso?: string | null): number | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000);
};
const productTitle = (c: SummaryContract) =>
  c.product?.name || [c.product?.brand, c.product?.model].filter(Boolean).join(' ') || 'เครื่อง';

const CONTRACT_STATUS: Record<string, { label: string; tone: string }> = {
  ACTIVE: { label: 'ใช้งาน', tone: 'bg-success/10 text-success' },
  OVERDUE: { label: 'ค้างชำระ', tone: 'bg-destructive/10 text-destructive' },
  DEFAULT: { label: 'ผิดนัด', tone: 'bg-destructive/10 text-destructive' },
  COMPLETED: { label: 'ปิดแล้ว', tone: 'bg-muted text-muted-foreground' },
};

/** ─── สัญญา: การ์ดตัวเอก ─── */
export function ContractHeroCard({ contract, overdueAmount }: { contract: SummaryContract; overdueAmount?: number }) {
  const navigate = useNavigate();
  const paid = contract.paidInstallments ?? 0;
  const total = contract.totalInstallments || 0;
  const left = Math.max(total - paid, 0);
  const pct = total > 0 ? Math.round((paid / total) * 100) : 0;
  const st = CONTRACT_STATUS[contract.status] ?? { label: contract.status, tone: 'bg-muted text-muted-foreground' };
  const dueIn = daysFromNow(contract.nextDueDate);
  const isLate = contract.status === 'OVERDUE' || contract.status === 'DEFAULT' || (dueIn != null && dueIn < 0);
  const nextNo = paid + 1;
  return (
    <div className="rounded-[10px] border border-border bg-card p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[13.5px] font-bold leading-[1.5]">{productTitle(contract)}</p>
        </div>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', st.tone)}>{st.label}</span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted-foreground">สัญญา</dt>
        <dd className="m-0 tabular-nums">{contract.contractNumber}</dd>
        {contract.createdAt && (
          <>
            <dt className="text-muted-foreground">เริ่ม</dt>
            <dd className="m-0 tabular-nums">{dmy(contract.createdAt)} · {total} งวด</dd>
          </>
        )}
      </dl>
      {total > 0 && (
        <div className="mt-2.5">
          <div className="mb-1 flex justify-between text-xs">
            <span>ชำระแล้ว <b>{paid}</b> / {total} งวด</span>
            <span className="text-muted-foreground">{pct}%</span>
          </div>
          <div className="flex h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={paid} aria-valuemin={0} aria-valuemax={total}>
            <i className="block h-full bg-success" style={{ width: `${pct}%` }} />
            {isLate && left > 0 && <i className="block h-full bg-destructive" style={{ width: `${Math.min(100 - pct, 100 / total)}%` }} />}
          </div>
        </div>
      )}
      <div className="mt-2.5 grid grid-cols-3 gap-1.5">
        <div className="min-w-0 rounded-lg bg-muted/50 px-2 py-1.5"><div className="text-[11.5px] text-muted-foreground">งวดละ</div><div className="whitespace-nowrap text-[13px] font-bold tabular-nums">{baht(contract.monthlyPayment)}</div></div>
        <div className="min-w-0 rounded-lg bg-muted/50 px-2 py-1.5"><div className="text-[11.5px] text-muted-foreground">เหลือ</div><div className="whitespace-nowrap text-[13px] font-bold tabular-nums">{left} งวด</div></div>
        <div className={cn('min-w-0 rounded-lg px-2 py-1.5', isLate ? 'bg-destructive/10' : 'bg-muted/50')}>
          <div className="text-[11.5px] text-muted-foreground">ค้างชำระ</div>
          <div className={cn('whitespace-nowrap text-[13px] font-bold tabular-nums', isLate && 'text-destructive')}>{overdueAmount != null ? baht(overdueAmount) : isLate ? baht(contract.monthlyPayment) : '—'}</div>
        </div>
      </div>
      {contract.nextDueDate && left > 0 && (
        <div className={cn('mt-2.5 flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-semibold', isLate ? 'bg-destructive/10 text-destructive' : 'bg-muted/50 text-foreground')}>
          {isLate && <AlertTriangle className="size-3.5 shrink-0" />}
          <span>งวด {nextNo} ครบกำหนด {dmy(contract.nextDueDate)}</span>
          <span className="ml-auto font-medium text-muted-foreground">
            {dueIn == null ? '' : dueIn < 0 ? `เลย ${-dueIn} วัน` : dueIn === 0 ? 'วันนี้' : `อีก ${dueIn} วัน`}
          </span>
        </div>
      )}
      <div className="mt-2.5 flex gap-1.5">
        <Button size="sm" className="flex-1" onClick={() => navigate(`/payments?contractId=${contract.id}`)}>รับชำระ</Button>
        <Button size="sm" variant="outline" className="flex-1" onClick={() => navigate(`/contracts/${contract.id}`)}>ดูสัญญา ›</Button>
      </div>
    </div>
  );
}

/** ─── ประวัติการชำระ: ไทม์ไลน์มีจุดสถานะ ─── */
export function PaymentsTimeline({ payments, contractId }: { payments: SummaryPayment[]; contractId?: string }) {
  const navigate = useNavigate();
  const rows = useMemo(() => [...payments].sort((a, b) => b.installmentNo - a.installmentNo).slice(0, 4), [payments]);
  const METHOD: Record<string, string> = { CASH: 'เงินสด', BANK_TRANSFER: 'โอน', QR_EWALLET: 'QR', ONLINE_GATEWAY: 'ออนไลน์' };
  return (
    <Group label="ประวัติการชำระ" count={payments.length} right={contractId ? <button type="button" onClick={() => navigate(`/contracts/${contractId}`)}>ดูทั้งหมด</button> : undefined}>
      {rows.length === 0 && <p className="m-0 text-xs text-muted-foreground">ยังไม่มีการชำระ</p>}
      <div className="flex flex-col">
        {rows.map((p) => {
          const paidFull = p.status === 'PAID' || num(p.amountPaid) >= num(p.amountDue);
          const late = !paidFull && (p.status === 'OVERDUE' || (daysFromNow(p.dueDate) ?? 1) < 0);
          const last = p.partials?.[0];
          const sub = paidFull
            ? [dmy(last?.paidDate), last?.paymentMethod ? METHOD[last.paymentMethod] ?? last.paymentMethod : null, last?.receiptNumber ? `ใบเสร็จ ${last.receiptNumber}` : null].filter(Boolean).join(' · ')
            : `ครบกำหนด ${dmy(p.dueDate) || '—'} · ${late ? 'เลยกำหนด' : 'ยังไม่ชำระ'}`;
          return (
            <div key={p.id} className="grid grid-cols-[18px_1fr_auto] items-center gap-2 border-b border-border py-1.5 text-xs last:border-b-0">
              <span className={cn('size-2.5 justify-self-center rounded-full', paidFull ? 'bg-success' : late ? 'bg-destructive' : 'border-2 border-border bg-card')} aria-hidden />
              <span className="min-w-0 text-foreground/90">
                งวด {p.installmentNo}
                <small className="block truncate text-[11.5px] text-muted-foreground">{sub}</small>
              </span>
              <span className={cn('font-bold tabular-nums', paidFull ? 'text-success' : late ? 'text-destructive' : 'font-medium text-muted-foreground')}>{baht(paidFull ? p.amountPaid : p.amountDue)}</span>
            </div>
          );
        })}
      </div>
    </Group>
  );
}

/** ─── บันทึกการโทร (โทรทวงจากสัญญา): ผลของสายเป็นหัว ─── */
export function CallLogList({ logs, onCall }: { logs: SummaryCallLog[]; onCall?: () => void }) {
  const RESULT: Record<string, string> = {
    ANSWERED: 'รับสาย', NO_ANSWER: 'ไม่รับสาย', BUSY: 'สายไม่ว่าง', PROMISE: 'รับสาย · สัญญาจะจ่าย', WRONG_NUMBER: 'เบอร์ผิด', CALLBACK: 'ขอให้โทรกลับ',
  };
  const rows = logs.slice(0, 4);
  return (
    <Group label="บันทึกการโทร" count={logs.length} right={onCall ? <button type="button" onClick={onCall} className="inline-flex items-center gap-1"><Phone className="size-3" /> โทร</button> : undefined}>
      {rows.length === 0 && <p className="m-0 text-xs text-muted-foreground">ยังไม่มีบันทึกการโทร</p>}
      {rows.map((l) => {
        const answered = l.result ? !['NO_ANSWER', 'BUSY', 'WRONG_NUMBER'].includes(l.result) : !!l.notes;
        const title = (l.result && RESULT[l.result]) || l.notes || 'บันทึกการโทร';
        return (
          <div key={l.id} className="grid grid-cols-[28px_1fr] items-start gap-2.5 border-b border-border py-2 text-xs last:border-b-0">
            <span className={cn('grid size-7 place-items-center rounded-full', answered ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')}><Phone className="size-3.5" /></span>
            <div className="min-w-0">
              <p className="m-0 truncate text-[12.5px] font-bold">{title}</p>
              <p className="m-0 text-muted-foreground">
                {new Date(l.calledAt).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                {l.caller?.name ? ` · ${l.caller.name}` : ''}
                {l.result && l.notes ? ` · ${l.notes}` : ''}
              </p>
            </div>
          </div>
        );
      })}
    </Group>
  );
}

/** ─── ประกัน: การ์ดต่อเครื่อง (ประกันศูนย์จาก Product.warrantyExpireDate · ประกันร้านจาก shopWarrantyEndDate) ─── */
export function DeviceWarrantyCard({ contract }: { contract: SummaryContract }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canReportIssue = AFTER_SALES_STAFF_ROLES.includes(user?.role ?? '');
  const imei = contract.serialNumber || contract.product?.serialNumber || null;
  const mfrEnd = contract.product?.warrantyExpireDate ?? null;
  const shopEnd = contract.shopWarrantyEndDate ?? null;
  const mfrLeft = daysFromNow(mfrEnd);
  const shopLeft = daysFromNow(shopEnd);
  const anyActive = (mfrLeft != null && mfrLeft > 0) || (shopLeft != null && shopLeft > 0);
  const soon = (mfrLeft != null && mfrLeft > 0 && mfrLeft <= 30) || (shopLeft != null && shopLeft > 0 && shopLeft <= 14);
  const start = contract.deviceReceivedAt ?? contract.createdAt ?? null;
  const pctUsed = (() => {
    if (!start || !mfrEnd) return null;
    const s = new Date(start).getTime(), e = new Date(mfrEnd).getTime();
    if (!(e > s)) return null;
    return Math.min(100, Math.max(0, Math.round(((Date.now() - s) / (e - s)) * 100)));
  })();
  const [copied, setCopied] = useState(false);
  const copyImei = async () => {
    if (!imei) return;
    try {
      await navigator.clipboard.writeText(imei);
      setCopied(true);
      toast.success(`คัดลอก ${imei} แล้ว`);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('คัดลอกไม่สำเร็จ — เลือกข้อความแล้วคัดลอกเอง');
    }
  };
  return (
    <div className="rounded-[10px] border border-border bg-card p-3">
      <div className="flex items-start gap-2">
        <p className="m-0 min-w-0 flex-1 text-[13.5px] font-bold leading-[1.5]">{productTitle(contract)}</p>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold', !anyActive ? 'bg-muted text-muted-foreground' : soon ? 'bg-warning/15 text-warning-foreground' : 'bg-success/10 text-success')}>
          {!anyActive ? 'หมดประกัน' : soon ? 'ใกล้หมด' : 'อยู่ในประกัน'}
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {start && (<><dt className="text-muted-foreground">ซื้อเมื่อ</dt><dd className="m-0 tabular-nums">{dmy(start)}</dd></>)}
        <dt className="text-muted-foreground">สัญญา</dt><dd className="m-0 tabular-nums">{contract.contractNumber}</dd>
      </dl>
      {imei && (
        <div className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-muted/50 px-2 py-1.5 text-xs">
          IMEI <code className="font-mono tracking-wide">{imei}</code>
          <button type="button" onClick={copyImei} className="ml-auto inline-flex items-center gap-1 text-[11.5px] font-semibold text-primary"><Copy className="size-3" /> {copied ? 'คัดลอกแล้ว' : 'คัดลอก'}</button>
        </div>
      )}
      <div className="mt-2.5">
        <div className="flex items-center gap-1.5 text-xs">
          <b>ประกันศูนย์</b>
          {mfrEnd ? (
            <span className={cn('ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold', mfrLeft != null && mfrLeft > 0 ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')}>
              {mfrLeft == null ? '' : mfrLeft > 0 ? `เหลือ ${mfrLeft} วัน` : 'หมดแล้ว'}
            </span>
          ) : (
            <span className="ml-auto text-muted-foreground">ไม่มีข้อมูล</span>
          )}
        </div>
        {mfrEnd && (
          <>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"><i className="block h-full bg-success" style={{ width: `${pctUsed ?? (mfrLeft != null && mfrLeft > 0 ? 50 : 100)}%` }} /></div>
            <div className="mt-1 flex justify-between text-[11.5px] text-muted-foreground"><span>{start ? `เริ่ม ${dmy(start)}` : ''}</span><span>หมด {dmy(mfrEnd)}</span></div>
          </>
        )}
      </div>
      <div className="mt-2.5 border-t border-border pt-2.5 text-xs">
        <div className="flex items-start gap-1.5">
          <b className="whitespace-nowrap">ประกันร้าน</b>
          {shopEnd ? (
            <span className="ml-auto text-right">
              <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-semibold', shopLeft != null && shopLeft > 0 ? 'bg-success/10 text-success' : 'bg-muted text-muted-foreground')}>{shopLeft != null && shopLeft > 0 ? `เหลือ ${shopLeft} วัน` : 'หมดแล้ว'}</span>
              <span className="block text-[11.5px] text-muted-foreground">ถึง {dmy(shopEnd)}</span>
            </span>
          ) : (
            <span className="min-w-0 flex-1 text-muted-foreground">เครื่องใหม่ — ใช้ประกันศูนย์ ไม่มีประกันร้าน</span>
          )}
        </div>
      </div>
      <div className="mt-2.5 flex gap-1.5">
        {canReportIssue && (
          <Button size="sm" className="flex-1" onClick={() => navigate(imei ? `/after-sales/new?imei=${encodeURIComponent(imei)}` : '/after-sales/new')}><Wrench className="mr-1 size-3.5" aria-hidden /> แจ้งปัญหาเครื่อง</Button>
        )}
        <Button size="sm" variant="outline" className="flex-1" onClick={() => navigate(`/contracts/${contract.id}`)}>ดูสัญญา ›</Button>
      </div>
    </div>
  );
}
