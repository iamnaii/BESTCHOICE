import { useState, type ReactNode } from 'react';
import CustomerTagDialog from '@/pages/CollectionsPage/components/CustomerTagDialog';
import { AlertTriangle, Loader2, ShieldAlert, ShieldBan } from 'lucide-react';
import { BLACKLIST_OVERRIDE_REASON_MIN, canOverrideBlacklist, type CustomerBlacklistResult } from '@installment/shared';
import BlacklistReasonList from '@/components/customer/BlacklistReasonList';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { maskNationalId } from '@/utils/mask.util';
import { useAuth } from '@/contexts/AuthContext';
import ProspectPhoneLine from '@/components/customer/ProspectPhoneLine';
import type { Customer } from '../types';

export interface CustomerSelectStepProps {
  customers: Customer[];
  customerSearch: string;
  setCustomerSearch: (v: string) => void;
  selectedCustomer: Customer | null;
  setSelectedCustomer: (c: Customer) => void;
  onNext: () => void;
  latestCreditCheck: { id: string; status: string; aiScore: number | null } | null | undefined;
  customerCreditApproved: boolean;
  onOpenCredit: () => void;
  onOpenCustomerModal: () => void;
  /** ก้อน 5 C3 — ผลตรวจ blacklist ของลูกค้าที่เลือก (API ตัดสิน) · โหลดอยู่/ล้ม = ปุ่มถัดไปปิด */
  blacklist: CustomerBlacklistResult | undefined;
  blacklistStatus: 'idle' | 'loading' | 'error' | 'ready';
  onRetryBlacklist: () => void;
  /** การปลดระดับ SOFT โดย OWNER/ผู้จัดการสาขา — ติ๊ก + เหตุผล ≥10 ตัว */
  overrideAccepted: boolean;
  setOverrideAccepted: (v: boolean) => void;
  overrideReason: string;
  setOverrideReason: (v: string) => void;
  /** การ์ด "ลูกค้ารู้จักร้านจากไหน" ของลูกค้าที่เลือก (index.tsx สร้าง) — วางระหว่างแถบเตือนสัญญาค้างกับกล่องเครดิต */
  heardFromSlot?: ReactNode;
  /** "ทักแชทครั้งแรกทาง …" ของลูกค้าที่เลือก (อ่านอย่างเดียว ไม่เขียน heardFrom) — แสดงเฉพาะในแถวที่เลือก */
  firstContactLine?: string | null;
}

export function CustomerSelectStep({
  customers,
  customerSearch,
  setCustomerSearch,
  selectedCustomer,
  setSelectedCustomer,
  onNext,
  latestCreditCheck,
  customerCreditApproved,
  onOpenCredit,
  onOpenCustomerModal,
  blacklist,
  blacklistStatus,
  onRetryBlacklist,
  overrideAccepted,
  setOverrideAccepted,
  overrideReason,
  setOverrideReason,
  heardFromSlot,
  firstContactLine,
}: CustomerSelectStepProps) {
  const { user } = useAuth();
  const visibleCustomers = selectedCustomer && !customers.some(customer => customer.id === selectedCustomer.id)
    ? [selectedCustomer, ...customers] : customers;
  const canOverride = canOverrideBlacklist(user?.role);
  const canRemoveTag = user?.role === 'OWNER' || user?.role === 'FINANCE_MANAGER';
  const roleLabel = user?.role === 'OWNER' ? 'เจ้าของ' : 'ผู้จัดการสาขา';
  const reasonLen = overrideReason.trim().length;
  // ก้อน 5 C3 — กล่องถอด tag ของจริง (CollectionsPage) เปิดได้จากที่นี่ ปิดแล้วตรวจ blacklist ใหม่ (review I3)
  const [tagDialogOpen, setTagDialogOpen] = useState(false);

  /** กล่องผลตรวจ blacklist (ก้อน 5 C3) — HARD แดงไม่มีทางปลด · SOFT เหลืองให้ OWNER/BM ปลด · โหลด/ล้ม = fail-closed */
  function renderBlacklistBox() {
    if (!selectedCustomer) return null;
    if (blacklistStatus === 'idle' || blacklistStatus === 'loading') {
      return (
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
          <Loader2 className="size-3.5 animate-spin" aria-hidden /> กำลังตรวจ blacklist…
        </div>
      );
    }
    if (blacklistStatus === 'error') {
      return (
        <div className="mt-4 rounded-xl border border-border bg-muted p-4 text-sm leading-snug">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>โหลดผลตรวจ blacklist ไม่ได้ — ต้องตรวจผ่านก่อนถึงไปต่อได้</span>
            <Button type="button" variant="outline" size="sm" onClick={onRetryBlacklist}>ลองใหม่</Button>
          </div>
        </div>
      );
    }
    if (!blacklist || blacklist.level === 'NONE') return null;
    if (blacklist.level === 'HARD') {
      const hasTag = blacklist.reasons.some((r) => r.code === 'MANUAL_TAG');
      return (
        <div role="alert" className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-start gap-3">
            <ShieldBan className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold leading-snug text-destructive">ห้ามทำสัญญา — ลูกค้าติด blacklist</div>
              <BlacklistReasonList reasons={blacklist.reasons} className="mt-2" />
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs leading-snug text-muted-foreground">
                <span>{'ไม่มีการอนุมัติข้าม — '}{hasTag && canRemoveTag ? 'ถ้า tag ติดผิด ถอดได้ที่นี่' : 'ติดต่อเจ้าของ/ผู้จัดการการเงิน'}</span>
                {hasTag && canRemoveTag && (
                  <Button type="button" variant="outline" size="sm" onClick={() => setTagDialogOpen(true)}>ถอด tag</Button>
                )}
              </div>
              {hasTag && canRemoveTag && (
                <CustomerTagDialog open={tagDialogOpen} customerId={selectedCustomer.id}
                  onClose={() => { setTagDialogOpen(false); onRetryBlacklist(); }} />
              )}
            </div>
          </div>
        </div>
      );
    }
    return (
      <div role="alert" className="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-4">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning-strong" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-snug text-warning-strong">ต้องให้ผู้จัดการอนุมัติก่อนทำสัญญา</div>
            <BlacklistReasonList reasons={blacklist.reasons} className="mt-2" />
            {canOverride ? (
              <div className="mt-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Checkbox id="blacklist-override" checked={overrideAccepted} onCheckedChange={(v) => setOverrideAccepted(v === true)} />
                  <label htmlFor="blacklist-override" className="cursor-pointer text-xs font-medium leading-snug">
                    อนุมัติทำสัญญาทั้งที่มีประวัติ (ในฐานะ {roleLabel})
                  </label>
                </div>
                <Textarea
                  id="blacklist-override-reason"
                  aria-label="เหตุผลการอนุมัติ"
                  placeholder="เหตุผลที่อนุมัติ เช่น ตรวจแล้วว่าผู้อ้างอิงไม่ใช่คนเดียวกัน (อย่างน้อย 10 ตัวอักษร)"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                  rows={2}
                />
                <div className={`text-xs leading-snug ${reasonLen < BLACKLIST_OVERRIDE_REASON_MIN ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {reasonLen}/{BLACKLIST_OVERRIDE_REASON_MIN}
                </div>
              </div>
            ) : (
              <div className="mt-2 text-xs leading-snug text-muted-foreground">กรุณาติดต่อผู้จัดการสาขาเพื่ออนุมัติ</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Add new customer button - at top */}
      <button data-ui-control="button"
        onClick={onOpenCustomerModal}
        className="w-full mb-4 py-3 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" />
        </svg>
        เพิ่มลูกค้าใหม่
      </button>

      <input aria-label="ค้นหาลูกค้า (ชื่อ, เบอร์โทร, เลขบัตร)"
        type="text"
        placeholder="ค้นหาลูกค้า (ชื่อ, เบอร์โทร, เลขบัตร)..."
        value={customerSearch}
        onChange={(e) => setCustomerSearch(e.target.value)}
        className="w-full px-3 py-2 border border-input rounded-lg text-sm mb-4"
      />
      <div className="grid gap-3">
        {visibleCustomers.map((c) => {
          const blocking = (c.activeContracts ?? 0) + (c.overdueContracts ?? 0);
          return (
            <div
              key={c.id}
              onClick={() => setSelectedCustomer(c)}
              onDoubleClick={() => { setSelectedCustomer(c); onNext(); }}
              className={`p-4 rounded-xl border cursor-pointer transition-all hover:shadow-sm ${selectedCustomer?.id === c.id ? 'border-primary bg-primary/5 shadow-sm' : 'border-border/60 hover:border-border bg-card'}`}
            >
              <div className="flex justify-between items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-medium text-sm">{c.name}</div>
                    {blocking > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-md bg-destructive/10 text-destructive px-1.5 py-0.5 text-[10px] font-semibold border border-destructive/20">
                        <AlertTriangle className="size-3" />
                        กำลังผ่อน {blocking} เครื่อง
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground"><ProspectPhoneLine phone={c.phone} chatPlaceholder={c.chatPlaceholder} /></div>
                  {selectedCustomer?.id === c.id && firstContactLine && (
                    <div className="mt-1 text-xs leading-snug text-muted-foreground">{firstContactLine}</div>
                  )}
                  {c.salary &&<div className="text-xs text-muted-foreground mt-1">เงินเดือน: <span className="tabular-nums font-mono">{parseFloat(c.salary).toLocaleString()}</span> ฿</div>}
                </div>
                <div className="text-xs text-muted-foreground font-mono">
                  {maskNationalId(c.nationalId)}
                </div>
              </div>
            </div>
          );
        })}
        {visibleCustomers.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">ไม่พบลูกค้า</div>
        )}
      </div>

      {/* ก้อน 5 C3 — ผลตรวจ blacklist (แทนแถบเตือนสัญญาค้าง + ช่องอนุมัติผ่อนซ้อนเดิม) */}
      {renderBlacklistBox()}

      {/* การ์ด "ลูกค้ารู้จักร้านจากไหน" (index.tsx ส่งมา) — หลังแถบเตือนสัญญาค้าง ก่อนกล่องเครดิต */}
      {heardFromSlot}

      {/* Credit check status for selected customer */}
      {selectedCustomer && (() => {
        const status = latestCreditCheck?.status;
        const isPending = status === 'PENDING';
        const isReview = status === 'MANUAL_REVIEW';
        const isRejected = status === 'REJECTED';
        const hasNoCheck = !latestCreditCheck;

        // Status-specific copy + action so user knows exactly what's blocking
        // and where to go next. Previously the button always said "ไปตรวจเครดิต"
        // even when the real action was "อนุมัติใน manual review".
        const label = customerCreditApproved
          ? 'ผ่าน'
          : isPending
            ? 'รอวิเคราะห์'
            : isRejected
              ? 'ไม่ผ่าน'
              : isReview
                ? 'ต้องตรวจเพิ่ม'
                : 'ยังไม่ได้ตรวจ';
        const detail = customerCreditApproved
          ? null
          : isPending
            ? 'ระบบกำลังวิเคราะห์ Statement — กรุณารอสักครู่แล้ว refresh'
            : isReview
              ? 'ผู้จัดการต้องตรวจสอบและอนุมัติก่อนสร้างสัญญาได้'
              : isRejected
                ? 'เครดิตไม่ผ่าน — ต้องยื่นตรวจใหม่พร้อมเอกสารเพิ่มเติม'
                : 'ลูกค้าต้องผ่านการตรวจเครดิตก่อนถึงจะสร้างสัญญาได้';
        const buttonLabel = hasNoCheck
          ? 'ไปตรวจเครดิต'
          : isReview
            ? 'ไปอนุมัติ'
            : isRejected
              ? 'ยื่นตรวจใหม่'
              : 'ดูรายละเอียด';

        return (
          <div className={`mt-4 rounded-xl border p-4 ${customerCreditApproved ? 'bg-success/5 dark:bg-success/10 border-success/20' : 'bg-destructive/5 dark:bg-destructive/10 border-destructive/20'}`}>
            <div className="flex items-center justify-between">
              <div>
                <div className={`text-sm font-semibold ${customerCreditApproved ? 'text-success' : 'text-destructive'}`}>
                  สถานะเครดิต: {label}
                </div>
                {latestCreditCheck?.aiScore != null && (
                  <div className="text-xs mt-1">คะแนน: {latestCreditCheck.aiScore}/100</div>
                )}
                {detail && (
                  <div className="text-xs text-destructive mt-1">{detail}</div>
                )}
              </div>
              {!customerCreditApproved && (
                <button data-ui-control="button"
                  onClick={onOpenCredit}
                  className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 whitespace-nowrap"
                >
                  {buttonLabel}
                </button>
              )}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
