import { maskNationalId } from '@/utils/mask.util';
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
}: CustomerSelectStepProps) {
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
        {customers.map((c) => (
          <div
            key={c.id}
            onClick={() => setSelectedCustomer(c)}
            onDoubleClick={() => { setSelectedCustomer(c); onNext(); }}
            className={`p-4 rounded-lg border cursor-pointer transition-colors ${selectedCustomer?.id === c.id ? 'border-primary bg-primary/5' : 'border-border hover:border-border'}`}
          >
            <div className="flex justify-between items-center">
              <div>
                <div className="font-medium text-sm">{c.name}</div>
                <div className="text-xs text-muted-foreground mt-1">{c.phone}</div>
                {c.salary && <div className="text-xs text-muted-foreground mt-1">เงินเดือน: {parseFloat(c.salary).toLocaleString()} ฿</div>}
              </div>
              <div className="text-xs text-muted-foreground font-mono">
                {maskNationalId(c.nationalId)}
              </div>
            </div>
          </div>
        ))}
        {customers.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm">ไม่พบลูกค้า</div>
        )}
      </div>


      {/* Credit check status for selected customer */}
      {selectedCustomer && (
        <div className={`mt-4 rounded-lg border p-4 ${customerCreditApproved ? 'bg-success/5 dark:bg-success/10 border-success/20' : 'bg-destructive/5 dark:bg-destructive/10 border-destructive/20'}`}>
          <div className="flex items-center justify-between">
            <div>
              <div className={`text-sm font-semibold ${customerCreditApproved ? 'text-success' : 'text-destructive'}`}>
                สถานะเครดิต: {customerCreditApproved ? 'ผ่าน' : latestCreditCheck ? (latestCreditCheck.status === 'PENDING' ? 'รอวิเคราะห์' : latestCreditCheck.status === 'REJECTED' ? 'ไม่ผ่าน' : 'ต้องตรวจเพิ่ม') : 'ยังไม่ได้ตรวจ'}
              </div>
              {latestCreditCheck?.aiScore != null && (
                <div className="text-xs mt-1">คะแนน: {latestCreditCheck.aiScore}/100</div>
              )}
              {!customerCreditApproved && (
                <div className="text-xs text-destructive mt-1">ลูกค้าต้องผ่านการตรวจเครดิตก่อนถึงจะสร้างสัญญาได้</div>
              )}
            </div>
            {!customerCreditApproved && (
              <button
                onClick={() => navigate('/credit-checks')}
                className="px-3 py-1.5 text-xs bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
              >
                ไปตรวจเครดิต
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
