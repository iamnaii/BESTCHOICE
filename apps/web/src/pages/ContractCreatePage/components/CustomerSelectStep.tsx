import { AlertTriangle } from 'lucide-react';
import { maskNationalId } from '@/utils/mask.util';
import { useAuth } from '@/contexts/AuthContext';
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
  navigate: (path: string) => void;
  onOpenCustomerModal: () => void;
  overrideActiveContractCheck: boolean;
  setOverrideActiveContractCheck: (v: boolean) => void;
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
  navigate,
  onOpenCustomerModal,
  overrideActiveContractCheck,
  setOverrideActiveContractCheck,
}: CustomerSelectStepProps) {
  const { user } = useAuth();
  const canOverride = user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER';
  const activeBlockingCount =
    (selectedCustomer?.activeContracts ?? 0) + (selectedCustomer?.overdueContracts ?? 0);

  return (
    <div>
      {/* Add new customer button - at top */}
      <button
        onClick={onOpenCustomerModal}
        className="w-full mb-4 py-3 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" />
        </svg>
        เพิ่มลูกค้าใหม่
      </button>

      <input
        type="text"
        placeholder="ค้นหาลูกค้า (ชื่อ, เบอร์โทร, เลขบัตร)..."
        value={customerSearch}
        onChange={(e) => setCustomerSearch(e.target.value)}
        className="w-full px-3 py-2 border border-input rounded-lg text-sm mb-4"
      />
      <div className="grid gap-3">
        {customers.map((c) => {
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
                  <div className="text-xs text-muted-foreground mt-1">{c.phone}</div>
                  {c.salary && <div className="text-xs text-muted-foreground mt-1">เงินเดือน: <span className="tabular-nums font-mono">{parseFloat(c.salary).toLocaleString()}</span> ฿</div>}
                </div>
                <div className="text-xs text-muted-foreground font-mono">
                  {maskNationalId(c.nationalId)}
                </div>
              </div>
            </div>
          );
        })}
        {customers.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">ไม่พบลูกค้า</div>
        )}
      </div>

      {/* Active-contract warning banner */}
      {selectedCustomer && activeBlockingCount > 0 && (
        <div className="mt-4 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="size-5 text-destructive flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="text-sm font-semibold text-destructive">
                ลูกค้ายังมีสัญญาที่กำลังผ่อนอยู่ {activeBlockingCount} รายการ
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                ตามนโยบาย — ลูกค้าที่มีสัญญาค้างผ่อนไม่สามารถเปิดสัญญาใหม่ได้
                {canOverride ? ' ผู้จัดการสามารถอนุมัติข้ามได้' : ' กรุณาติดต่อผู้จัดการเพื่ออนุมัติ'}
              </div>
              {canOverride && (
                <label className="mt-3 flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={overrideActiveContractCheck}
                    onChange={(e) => setOverrideActiveContractCheck(e.target.checked)}
                    className="size-4 rounded border-input"
                  />
                  <span className="font-medium">อนุมัติผ่อนซ้อน (ในฐานะ {user?.role === 'OWNER' ? 'เจ้าของ' : 'ผู้จัดการสาขา'})</span>
                </label>
              )}
            </div>
          </div>
        </div>
      )}

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
        const buttonHref = hasNoCheck
          ? '/credit-checks'
          : `/customers/${selectedCustomer.id}?tab=credit`;

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
                <button
                  onClick={() => navigate(buttonHref)}
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
