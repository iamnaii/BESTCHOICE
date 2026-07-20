import { useMemo, useState } from 'react';
import { FocusScope } from '@radix-ui/react-focus-scope';
import { WizardStackedOverlay } from '@/components/WizardStackedOverlay';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  PackageX,
  Gauge,
  Calculator,
  Banknote,
  FileText,
  Check,
  X,
  AlertTriangle,
  Lock,
  Store,
} from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { formatNumberDecimal } from '@/utils/formatters';
import { CashAccountSelect, KBANK_ONLY_CODES } from '@/components/CashAccountSelect';
import { useAuth } from '@/contexts/AuthContext';

interface Props {
  contractId: string;
  contractNumber: string;
  customerName: string;
  branchName?: string;
  onClose: () => void;
  onSuccess: () => void;
}

interface RepoPreview {
  contract: {
    contractNumber: string;
    customer: { name: string };
    product: { brand: string; model: string };
    totalMonths: number;
    monthlyPayment: number;
    sellingPrice: number;
    financedAmount: number;
    storeCommission: number;
  };
  calculation: {
    remainingMonths: number;
    totalPaid: number;
    outstandingBalance: number;
    principalExVat: number;
    financeCost: number;
    remainingCost: number;
    grossProfit: number;
    discountPct: number;
    discountAmount: number;
    unpaidLateFees: number;
    closingAmount: number;
    marketValue: number;
    customerRefundEnabled: boolean;
    customerRefund: number;
    profitLoss: number;
  };
  /** Dry-run JP5 JE — same buildJe as the posting path (null เมื่อ preview ล้มเหลว/ไม่มีงวดค้าง) */
  journalPreview?: {
    lines: {
      accountCode: string;
      accountName: string;
      debit: string;
      credit: string;
      description: string;
    }[];
    totalDebit: string;
    totalCredit: string;
    isBalanced: boolean;
  } | null;
}

const GRADES = ['A', 'B', 'C', 'D'];
const PREVIEW_ROLES = ['OWNER', 'BRANCH_MANAGER', 'FINANCE_MANAGER'];

/** Today's date in Asia/Bangkok (YYYY-MM-DD) — avoids UTC off-by-one during BKK evening. */
const bkkToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

/**
 * In-modal "คืนเครื่อง" (repossession) overlay — full create, mirrors EarlyPayoffOverlay's
 * portal pattern. Live P&L preview via GET /repossessions/preview/:id; submit POST /repossessions
 * (JP5 + contract/product status changes, atomic server-side). Role-gated per backend:
 * create = OWNER only; preview = OWNER / BRANCH_MANAGER / FINANCE_MANAGER.
 */
export function RepossessionOverlay({
  contractId,
  contractNumber,
  customerName,
  branchName,
  onClose,
  onSuccess,
}: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canPreview = PREVIEW_ROLES.includes(user?.role ?? '');
  const canCreate = user?.role === 'OWNER';

  const [repossessedDate, setRepossessedDate] = useState(bkkToday);
  const [conditionGrade, setConditionGrade] = useState('A');
  const [appraisalPrice, setAppraisalPrice] = useState('');
  const [repairCost, setRepairCost] = useState('0');
  const [marketValue, setMarketValue] = useState('');
  const [discountPct, setDiscountPct] = useState('50');
  const [customerRefundEnabled, setCustomerRefundEnabled] = useState(false);
  // Owner rule 2026-07-08: direct FINANCE receipt = ธนาคารกสิกร (11-1201) only;
  // เครื่อง/เงินที่อยู่หน้าร้านใช้ collectedByShop → Dr 11-2107 (เหมือนปิดยอด).
  const [depositAccountCode, setDepositAccountCode] = useState('11-1201');
  const [collectedByShop, setCollectedByShop] = useState(false);
  // วันที่รับเงิน/ลงบัญชี (mirror ปิดยอด) — ย้อนหลังได้ถ้างวดบัญชียังเปิด
  const [paymentDate, setPaymentDate] = useState(bkkToday);
  const [notes, setNotes] = useState('');
  // Settlement dialog (mirror ปิดยอด) — หน้าร้านโอนเงินยึดคืนเข้า FINANCE ทีหลัง
  // แล้วเคลียร์ Dr 11-2107 ผ่าน endpoint เดียวกับ JP4 (sums 11-2107 by contractId)
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [settlementAccountCode, setSettlementAccountCode] = useState('11-1201');
  const [settlementAmount, setSettlementAmount] = useState('');
  const canSettlement = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'].includes(user?.role ?? '');

  const { data: preview, isLoading: previewLoading } = useQuery<RepoPreview>({
    queryKey: [
      'repossession-preview',
      contractId,
      marketValue,
      appraisalPrice,
      discountPct,
      customerRefundEnabled,
      depositAccountCode,
      collectedByShop,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (marketValue) params.set('marketValue', marketValue);
      // ราคากลางเว้นว่าง → ให้ backend ใช้ราคาประเมินตาม placeholder
      if (appraisalPrice) params.set('appraisalPrice', appraisalPrice);
      if (discountPct) params.set('discountPct', discountPct);
      params.set('customerRefundEnabled', String(customerRefundEnabled));
      // JOURNAL AUTO dry-run — mirror ตอน create: collectedByShop → Dr 11-2107
      params.set('depositAccountCode', depositAccountCode);
      params.set('collectedByShop', String(collectedByShop));
      const { data } = await api.get(`/repossessions/preview/${contractId}?${params.toString()}`);
      return data;
    },
    enabled: canPreview && !!contractId,
  });

  const mutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/repossessions', {
        contractId,
        repossessedDate,
        conditionGrade,
        appraisalPrice: Number(appraisalPrice),
        repairCost: repairCost ? Number(repairCost) : 0,
        notes: notes || undefined,
        marketValue: marketValue ? Number(marketValue) : undefined,
        discountPct: discountPct ? Number(discountPct) : 50,
        customerRefundEnabled,
        depositAccountCode: collectedByShop ? undefined : depositAccountCode,
        collectedByShop,
        // Cleared input = '' → omit so the server defaults to today (an empty
        // string fails @IsDateString with a 400)
        paymentDate: paymentDate || undefined,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('บันทึกการยึดคืนสำเร็จ');
      // Match the parent PaymentsPage query keys so the queue refreshes immediately.
      queryClient.invalidateQueries({ queryKey: ['contract', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['repossessions'] });
      queryClient.invalidateQueries({ queryKey: ['pending-payments'] });
      queryClient.invalidateQueries({ queryKey: ['pending-summary'] });
      queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
      onSuccess();
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const settlementMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/contracts/${contractId}/shop-collect-settlement`, {
        depositAccountCode: settlementAccountCode,
        amount: Number(settlementAmount),
      });
      return data;
    },
    onSuccess: () => {
      toast.success('บันทึกรับโอนจากหน้าร้านสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['contract', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['repossessions'] });
      setSettlementOpen(false);
      setSettlementAmount('');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const appraisalNum = Number(appraisalPrice);
  const canSubmit = useMemo(
    () =>
      canCreate &&
      repossessedDate.length > 0 &&
      !!conditionGrade &&
      appraisalNum > 0 &&
      !mutation.isPending,
    [canCreate, repossessedDate, conditionGrade, appraisalNum, mutation.isPending],
  );

  const inputClass =
    'w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 outline-hidden';

  return (
    <WizardStackedOverlay maxWidthClass="max-w-2xl">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm leading-snug text-muted-foreground hover:text-foreground transition-colors"
        >
          ← กลับ
        </button>
        <h2 className="text-lg font-semibold text-foreground leading-snug">คืนเครื่อง (ยึดคืน)</h2>
        <div className="w-16" />
      </div>

      <div className="p-6 space-y-5">
        {/* OWNER-only notice */}
        {!canCreate && (
          <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-3">
            <Lock className="size-4 text-warning shrink-0 mt-0.5" />
            <div className="text-xs text-warning leading-snug">
              <strong className="block">การยึดคืนทำได้เฉพาะเจ้าของ (OWNER)</strong>
              {canPreview
                ? 'ดูตัวอย่างกำไร/ขาดทุนได้ แต่กดยึดคืนจริงไม่ได้ — ให้เจ้าของเป็นผู้ยืนยัน'
                : 'บทบาทนี้ดูตัวอย่าง P&L และยึดคืนไม่ได้ — ให้เจ้าของเป็นผู้ดำเนินการ'}
            </div>
          </div>
        )}

        {/* Section 1: ข้อมูลสัญญา */}
        <Section
          icon={<PackageX className="size-4" />}
          title="ข้อมูลสัญญา"
          subtitle="เลขที่, ลูกค้า, สินค้า"
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-muted-foreground">สัญญา: </span>
              <span className="font-mono font-semibold">{contractNumber}</span>
            </div>
            <div>
              <span className="text-muted-foreground">ลูกค้า: </span>
              <span className="font-medium">{customerName}</span>
            </div>
            {preview?.contract.product && (
              <div>
                <span className="text-muted-foreground">สินค้า: </span>
                <span className="font-medium">
                  {preview.contract.product.brand} {preview.contract.product.model}
                </span>
              </div>
            )}
            {branchName && (
              <div>
                <span className="text-muted-foreground">สาขา: </span>
                <span className="font-medium">{branchName}</span>
              </div>
            )}
          </div>
        </Section>

        {/* Section 2: สภาพเครื่อง + ราคาประเมิน */}
        <Section
          icon={<Gauge className="size-4" />}
          title="สภาพเครื่อง + ราคาประเมิน"
          subtitle="เกรดสภาพ, ราคาตี, ค่าซ่อม"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5 leading-snug">
                  วันที่ยึดคืน <span className="text-destructive">*</span>
                </label>
                <input
                  type="date"
                  value={repossessedDate}
                  max={bkkToday()}
                  onChange={(e) => setRepossessedDate(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5 leading-snug">
                  เกรดสภาพ <span className="text-destructive">*</span>
                </label>
                <div className="flex gap-2">
                  {GRADES.map((g) => (
                    <button
                      key={g}
                      type="button"
                      aria-pressed={conditionGrade === g}
                      onClick={() => setConditionGrade(g)}
                      className={`flex-1 px-2 py-2 text-sm rounded-lg border transition-colors ${
                        conditionGrade === g
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'bg-background border-input hover:bg-muted'
                      }`}
                    >
                      {g}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5 leading-snug">
                  ราคาประเมิน (฿) <span className="text-destructive">*</span>
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={appraisalPrice}
                  onChange={(e) => setAppraisalPrice(e.target.value)}
                  className={`${inputClass} text-right font-mono`}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5 leading-snug">
                  ค่าซ่อม (฿)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={repairCost}
                  onChange={(e) => setRepairCost(e.target.value)}
                  className={`${inputClass} text-right font-mono`}
                  placeholder="0.00"
                />
              </div>
            </div>
          </div>
        </Section>

        {/* Section 3: คำนวณกำไร/ขาดทุน */}
        <Section
          icon={<Calculator className="size-4" />}
          title="คำนวณกำไร/ขาดทุน (FINANCE)"
          subtitle="ราคากลาง, ส่วนลด, เงินคืนลูกค้า"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5 leading-snug">
                  ราคากลางเครื่อง (฿)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={marketValue}
                  onChange={(e) => setMarketValue(e.target.value)}
                  className={`${inputClass} text-right font-mono`}
                  placeholder="ใช้ราคาประเมินถ้าเว้นว่าง"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5 leading-snug">
                  ส่วนลดยอดปิด (%)
                </label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={discountPct}
                  onChange={(e) => setDiscountPct(e.target.value)}
                  className={`${inputClass} text-right font-mono`}
                  placeholder="50"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 cursor-pointer px-3 py-2.5 rounded-lg bg-muted hover:bg-accent transition-colors">
              <input
                type="checkbox"
                checked={customerRefundEnabled}
                onChange={(e) => setCustomerRefundEnabled(e.target.checked)}
                className="size-4 accent-primary cursor-pointer"
              />
              <span className="text-sm font-medium text-foreground leading-snug">
                คืนเงินส่วนต่างให้ลูกค้า
              </span>
              <span className="text-xs text-muted-foreground ml-auto leading-snug">
                (กรณีราคากลาง &gt; ยอดปิด)
              </span>
            </label>

            {/* Live breakdown */}
            {!canPreview ? (
              <div className="py-6 text-center text-sm leading-snug text-muted-foreground">
                ดูตัวอย่าง P&L ได้เฉพาะ OWNER / ผจก.สาขา / ผจก.การเงิน
              </div>
            ) : previewLoading || !preview ? (
              <div className="py-6 text-center text-sm leading-snug text-muted-foreground">
                กำลังคำนวณ...
              </div>
            ) : (
              <div className="rounded-xl bg-muted/60 p-4 space-y-2">
                <Row
                  label="ยอดค้าง (รวม VAT)"
                  value={`${preview.calculation.outstandingBalance.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`}
                />
                <Row
                  label="ค่างวดไม่รวม VAT (÷ 1.07)"
                  value={`${preview.calculation.principalExVat.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`}
                />
                <Row
                  label="ต้นทุนยอดค้างชำระ (ยอดจัด + คอม)"
                  value={`${preview.calculation.remainingCost.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`}
                />
                <div className="border-t border-border pt-2">
                  <Row
                    label={`ส่วนลดลูกค้า (${preview.calculation.discountPct}%)`}
                    value={`- ${preview.calculation.discountAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`}
                    destructive
                  />
                </div>
                {preview.calculation.unpaidLateFees > 0 && (
                  <Row
                    label="ค่าปรับค้างชำระ"
                    value={`+ ${preview.calculation.unpaidLateFees.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`}
                    destructive
                  />
                )}
                <div className="border-t border-border pt-2">
                  <Row
                    label="ยอดปิดสัญญา (ตรงกับปิดยอดก่อนกำหนด)"
                    value={`${preview.calculation.closingAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`}
                    bold
                  />
                </div>
                <div className="border-t border-border pt-2 space-y-2">
                  <Row
                    label="ราคากลางเครื่อง"
                    value={`${preview.calculation.marketValue.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`}
                  />
                  {preview.calculation.customerRefundEnabled && (
                    <Row
                      label="เงินคืนลูกค้า"
                      value={`- ${preview.calculation.customerRefund.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`}
                      destructive
                    />
                  )}
                </div>
                <div
                  className={`flex justify-between items-center mt-2 p-3 rounded-lg ${
                    preview.calculation.profitLoss >= 0
                      ? 'bg-success/10 ring-1 ring-success/30'
                      : 'bg-destructive/10 ring-1 ring-destructive/30'
                  }`}
                >
                  <div>
                    <div
                      className={`text-xs font-medium leading-snug ${preview.calculation.profitLoss >= 0 ? 'text-success' : 'text-destructive'}`}
                    >
                      {preview.calculation.profitLoss >= 0 ? (
                        <>
                          <Check className="size-4 inline mr-1" />
                          บริษัทได้กำไร
                        </>
                      ) : (
                        <>
                          <X className="size-4 inline mr-1" />
                          บริษัทขาดทุน
                        </>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground leading-snug">
                      ราคากลาง − ยอดปิดสัญญา − เงินคืน
                    </div>
                  </div>
                  <div
                    className={`text-xl font-bold ${preview.calculation.profitLoss >= 0 ? 'text-success' : 'text-destructive'}`}
                  >
                    {preview.calculation.profitLoss >= 0 ? '+' : ''}
                    {preview.calculation.profitLoss.toLocaleString('th-TH', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}{' '}
                    ฿
                  </div>
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* Section 4: รับชำระ (JP5 deposit leg) — wording + date mirror ปิดยอด (owner 2026-07-09) */}
        <Section
          icon={<Banknote className="size-4" />}
          title="รับชำระ"
          subtitle="วันที่, บัญชีรับเงิน"
          tone="warning"
        >
          <div className="mb-3">
            <label className="block text-xs font-medium text-foreground mb-1.5">
              วันที่รับเงิน{' '}
              <span className="text-muted-foreground font-normal">
                (ย้อนหลังได้ถ้างวดบัญชียังเปิด)
              </span>
            </label>
            <input
              type="date"
              value={paymentDate}
              max={bkkToday()}
              onChange={(e) => setPaymentDate(e.target.value)}
              className={`${inputClass} font-mono`}
            />
          </div>
          {/* Shop-collect toggle — mirrors early payoff (JP4) */}
          <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 px-3 py-3 mb-3">
            <input
              id="repo-collected-by-shop"
              type="checkbox"
              checked={collectedByShop}
              onChange={(e) => setCollectedByShop(e.target.checked)}
              className="mt-0.5 size-4 accent-primary cursor-pointer"
            />
            <label htmlFor="repo-collected-by-shop" className="cursor-pointer select-none">
              <span className="flex items-center gap-1.5 text-sm font-medium text-foreground leading-snug">
                <Store className="size-3.5 shrink-0 text-primary" />
                ตั้งลูกหนี้-หน้าร้าน
              </span>
              <span className="text-xs text-muted-foreground leading-snug">
                เครื่อง/เงินอยู่ที่หน้าร้าน แล้วหน้าร้านโอนเข้า FINANCE ภายหลัง (บันทึก Dr 11-2107
                ลูกหนี้-หน้าร้าน — เหมือนปิดยอด)
              </span>
            </label>
          </div>
          <label className="block text-xs font-medium text-foreground mb-1.5">บัญชีรับเงิน</label>
          <CashAccountSelect
            value={depositAccountCode}
            onChange={setDepositAccountCode}
            disabled={collectedByShop}
            codes={KBANK_ONLY_CODES}
          />
          {collectedByShop && (
            <p className="mt-1 text-xs text-muted-foreground leading-snug">
              บัญชีถูกกำหนดเป็น 11-2107 อัตโนมัติโดยระบบ — กรอกบัญชีรับโอนจากหน้าร้านตอน settlement
            </p>
          )}
        </Section>

        {/* Section 5: หมายเหตุ */}
        <Section
          icon={<FileText className="size-4" />}
          title="หมายเหตุ"
          subtitle="บันทึกเพิ่มเติม (ถ้ามี)"
        >
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className={`${inputClass} resize-none`}
            placeholder="เช่น สาเหตุการยึด, สภาพเครื่อง..."
          />
        </Section>

        {/* Section 5.5: JOURNAL AUTO — JP5 JE preview (dry-run บรรทัดเดียวกับตอน post) */}
        {canPreview && preview?.journalPreview && (
          <Section
            icon={<FileText className="size-4" />}
            title="JOURNAL AUTO — บันทึกทางบัญชี"
            subtitle="JP5 — ยึดเครื่อง + ใบลดหนี้ VAT (ม.82/5)"
          >
            <div className="space-y-1">
              <div className="grid grid-cols-[80px_1fr_90px_90px] gap-1 text-xs text-muted-foreground font-medium pb-1 border-b border-border">
                <span>รหัส</span>
                <span>บัญชี</span>
                <span className="text-right">Dr</span>
                <span className="text-right">Cr</span>
              </div>
              {preview.journalPreview.lines.map((line, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[80px_1fr_90px_90px] gap-1 text-xs leading-snug"
                >
                  <span className="font-mono text-muted-foreground">{line.accountCode}</span>
                  <div className="min-w-0">
                    <span className="text-foreground truncate block">{line.accountName}</span>
                    <span className="text-muted-foreground/70 text-[10px]">{line.description}</span>
                  </div>
                  <span className="text-right font-mono text-foreground">
                    {parseFloat(line.debit) > 0 ? formatNumberDecimal(line.debit) : ''}
                  </span>
                  <span className="text-right font-mono text-foreground">
                    {parseFloat(line.credit) > 0 ? formatNumberDecimal(line.credit) : ''}
                  </span>
                </div>
              ))}
            </div>
            <div
              className={`flex items-center justify-between mt-3 pt-2 border-t text-xs font-medium ${
                preview.journalPreview.isBalanced
                  ? 'border-success/30 text-success'
                  : 'border-destructive/30 text-destructive'
              }`}
            >
              <span>Dr รวม = Cr รวม</span>
              <span className="font-mono">
                {formatNumberDecimal(preview.journalPreview.totalDebit)} ={' '}
                {formatNumberDecimal(preview.journalPreview.totalCredit)}{' '}
                {preview.journalPreview.isBalanced ? 'BALANCED' : 'UNBALANCED'}
              </span>
            </div>
          </Section>
        )}

        {/* Section 6: สิ่งที่จะเกิดขึ้น */}
        <Section
          icon={<Check className="size-4" />}
          title="สิ่งที่จะเกิดขึ้นเมื่อยืนยัน"
          subtitle="ตรวจสอบก่อนยึดคืน"
          tone="success"
        >
          <ul className="space-y-1.5 text-sm">
            <Effect text="ปิดลูกหนี้คงค้าง + ออกใบลดหนี้ VAT (ม.82/5) — บันทึก JE (JP5)" />
            {collectedByShop && (
              <Effect
                text="ตั้งลูกหนี้-หน้าร้าน 11-2107 — ต้องบันทึกรับโอนจากหน้าร้าน (settlement) ภายหลัง"
                warning
              />
            )}
            <Effect text="บันทึกกำไร/ขาดทุนจากการยึด (41-1102 / 51-1102)" />
            <Effect text="เปลี่ยนสถานะสัญญาเป็น ปิด-หนี้สูญ + สินค้าเป็น ยึดคืน" />
            <Effect text="จัดการซ่อม/ตั้งราคาขายต่อ ทำต่อที่หน้า ยึดคืน & ขายต่อ" warning />
            <Effect text="ปลดล็อค MDM (PJ-Soft) — ต้องทำ manual" warning />
          </ul>
        </Section>
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 flex items-center justify-between gap-3">
        {/* Settlement button — visible to OWNER / FINANCE_MANAGER / ACCOUNTANT (mirror ปิดยอด) */}
        {canSettlement ? (
          <button
            type="button"
            onClick={() => setSettlementOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors text-muted-foreground"
          >
            <Store className="size-4" />
            บันทึกรับโอนจากหน้าร้าน
          </button>
        ) : (
          <div />
        )}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="px-6 py-2.5 text-sm leading-snug border border-input rounded-lg hover:bg-muted transition-colors"
          >
            ยกเลิก
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit}
            title={
              !canCreate
                ? 'เฉพาะเจ้าของ (OWNER) ยึดคืนได้'
                : appraisalNum <= 0
                  ? 'กรุณาระบุราคาประเมิน'
                  : undefined
            }
            className="px-6 py-2.5 text-sm leading-snug bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm"
          >
            {mutation.isPending ? 'กำลังบันทึก...' : 'ยืนยันยึดคืน'}
          </button>
        </div>
      </div>

      {/* Settlement dialog — Dr cash / Cr 11-2107 when shop remits to FINANCE.
          Own trapped FocusScope: keeps Tab inside the popup (the repossession
          panel underneath stays mounted and tabbable otherwise); nested scopes
          pause the outer overlay's via Radix's scope stack. */}
      {settlementOpen && (
        <div className="fixed inset-0 z-60 bg-black/50 backdrop-blur-xs flex items-center justify-center">
          <FocusScope asChild loop trapped>
            <div className="w-full max-w-sm bg-background rounded-xl shadow-2xl p-6 space-y-4">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                  <Store className="size-4" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-foreground leading-snug">
                    บันทึกรับโอนจากหน้าร้าน
                  </h3>
                  <p className="text-xs text-muted-foreground leading-snug">
                    Dr บัญชีรับเงิน / Cr 11-2107 ลูกหนี้-หน้าร้าน
                  </p>
                </div>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    บัญชีรับเงิน (FINANCE) <span className="text-destructive">*</span>
                  </label>
                  <CashAccountSelect
                    value={settlementAccountCode}
                    onChange={setSettlementAccountCode}
                    codes={KBANK_ONLY_CODES}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    จำนวนเงินที่รับโอน <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="number"
                    min={0.01}
                    step={0.01}
                    value={settlementAmount}
                    onChange={(e) => setSettlementAmount(e.target.value)}
                    className={inputClass}
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSettlementOpen(false)}
                  disabled={settlementMutation.isPending}
                  className="px-4 py-2 text-sm border border-input rounded-lg hover:bg-muted transition-colors"
                >
                  ยกเลิก
                </button>
                <button
                  type="button"
                  onClick={() => settlementMutation.mutate()}
                  disabled={
                    settlementMutation.isPending ||
                    !settlementAccountCode ||
                    !settlementAmount ||
                    Number(settlementAmount) <= 0
                  }
                  className="px-5 py-2 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors"
                >
                  {settlementMutation.isPending ? 'กำลังบันทึก...' : 'ยืนยัน'}
                </button>
              </div>
            </div>
          </FocusScope>
        </div>
      )}
    </WizardStackedOverlay>
  );
}

/* ─── Local helpers (token-only styling, mirrors EarlyPayoffOverlay) ─────────── */
function Section({
  icon,
  title,
  subtitle,
  tone = 'primary',
  children,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  tone?: 'primary' | 'success' | 'warning';
  children: React.ReactNode;
}) {
  const iconClass =
    tone === 'success'
      ? 'bg-success/10 text-success'
      : tone === 'warning'
        ? 'bg-warning/10 text-warning'
        : 'bg-primary/10 text-primary';
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-2.5 mb-4">
        <div className={`flex items-center justify-center size-8 rounded-lg ${iconClass}`}>
          {icon}
        </div>
        <div>
          <h3 className="text-sm font-semibold text-foreground leading-snug">{title}</h3>
          {subtitle && <p className="text-xs text-muted-foreground leading-snug">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  destructive,
}: {
  label: string;
  value: string;
  bold?: boolean;
  destructive?: boolean;
}) {
  const valueClass = destructive
    ? 'text-destructive font-medium'
    : bold
      ? 'font-semibold text-foreground'
      : 'text-foreground';
  return (
    <div className="flex justify-between items-baseline text-sm">
      <span className="text-muted-foreground leading-snug">{label}</span>
      <span className={`leading-snug ${valueClass}`}>{value}</span>
    </div>
  );
}

function Effect({ text, warning }: { text: string; warning?: boolean }) {
  return (
    <li className="flex items-start gap-2">
      <span className={warning ? 'text-warning' : 'text-success'}>
        {warning ? (
          <AlertTriangle className="size-4 inline" />
        ) : (
          <Check className="size-4 inline" />
        )}
      </span>
      <span className={warning ? 'text-warning' : 'text-foreground'}>{text}</span>
    </li>
  );
}
