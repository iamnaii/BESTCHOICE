import { useEffect, useMemo, useState } from 'react';
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
    rescheduleAdvanceApplied?: number;
    closingAmount: number;
    marketValue: number;
    /** ที่มาของราคากลางที่ใช้คำนวณ — null = ยังไม่ได้กรอกทั้งราคากลางและราคาประเมิน (ยังคำนวณไม่ได้) */
    marketValueSource: 'MARKET' | 'APPRAISAL' | null;
    customerRefundEnabled: boolean;
    customerRefund: number;
    profitLoss: number;
  };
  /** ยึดได้ไหม ณ ตอนนี้ (สถานะสัญญา + strict mode) — กติกาเดียวกับตอนบันทึกจริง */
  eligibility?: { canRepossess: boolean; reason: string | null } | null;
  /** ราคากลางแนะนำจากตารางรับซื้อมือสอง (ยี่ห้อ+รุ่น+ความจุ+เกรดที่เลือก) */
  valuation?: {
    grade: string;
    found: boolean;
    suggestedPrice: number | null;
    note: string | null;
  } | null;
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
const RETURN_REASONS = [
  { value: 'UNAFFORDABLE', label: 'ลูกค้าไม่สามารถผ่อนต่อได้' },
  { value: 'NO_LONGER_NEEDED', label: 'ลูกค้าไม่ประสงค์ใช้งานต่อ' },
  { value: 'AFTER_TERMINATION', label: 'รับเครื่องคืนหลังบอกเลิกสัญญา' },
  { value: 'OTHER', label: 'อื่น ๆ' },
];

/** Today's date in Asia/Bangkok (YYYY-MM-DD) — avoids UTC off-by-one during BKK evening. */
const bkkToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

/**
 * ผลทางบัญชี (ledger P&L) จาก JP5 journalPreview — คำสั่งเจ้าของ 2026-08-08 (ข้อ 1):
 * โชว์คู่กับ "กำไร/ขาดทุนเชิงบริหาร" (calculation.profitLoss ซึ่งมีส่วนลด/ราคากลาง)
 * เพราะสองเลขนี้ต่างกันได้โดยตั้งใจ. อ่านตรงจากบรรทัด JE: 41-1102 (Cr) = กำไรจากการยึดสินค้า,
 * 51-1102 (Dr) = ขาดทุนจากยึดเครื่อง. บรรทัด 21-1107 (เงินคืนส่วนต่างลูกค้า, Task 2) วางก่อน
 * plug ในเทมเพลตแล้ว — ตัวเลขนี้จึงรวมผลของเงินคืนอยู่ในตัวโดยอัตโนมัติ ไม่ต้องคำนวณซ้ำ.
 */
function computeLedgerPl(journalPreview: RepoPreview['journalPreview']): number {
  if (!journalPreview) return 0;
  let pl = 0;
  for (const line of journalPreview.lines) {
    if (line.accountCode === '41-1102') {
      const cr = parseFloat(line.credit);
      if (cr > 0) pl += cr;
    } else if (line.accountCode === '51-1102') {
      const dr = parseFloat(line.debit);
      if (dr > 0) pl -= dr;
    }
  }
  return pl;
}

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
  // ราคาเดียว (คำตัดสินเจ้าของ 2026-09-05): ราคาประเมิน = ราคาที่หน้าร้านรับเครื่อง = ยอดที่ลงบัญชี
  // ตารางรับซื้อเป็นค่าตั้งต้น + ตัวเทียบ. autoPrice แยก "ค่าที่ระบบเติม" ออกจาก "พนักงานพิมพ์เอง":
  // เปลี่ยนเกรดแล้วค่าตั้งต้นถูกสลับให้ แต่ค่าที่พิมพ์เองไม่ถูกทับ
  const [autoPrice, setAutoPrice] = useState<string | null>(null);
  const [discountPct, setDiscountPct] = useState('50');
  // Owner rule 2026-07-08: direct FINANCE receipt = ธนาคารกสิกร (11-1201) only;
  // เครื่อง/เงินที่อยู่หน้าร้านใช้ collectedByShop → Dr 11-2107 (เหมือนปิดยอด).
  const [depositAccountCode, setDepositAccountCode] = useState('11-1201');
  const [collectedByShop, setCollectedByShop] = useState(false);
  // วันที่รับเงิน/ลงบัญชี (mirror ปิดยอด) — ย้อนหลังได้ถ้างวดบัญชียังเปิด
  const [paymentDate, setPaymentDate] = useState(bkkToday);
  const [notes, setNotes] = useState('');
  const [returnReason, setReturnReason] = useState('');
  // Settlement dialog (mirror ปิดยอด) — หน้าร้านโอนเงินยึดคืนเข้า FINANCE ทีหลัง
  // แล้วเคลียร์ Dr 11-2107 ผ่าน endpoint เดียวกับ JP4 (sums 11-2107 by contractId)
  const [settlementOpen, setSettlementOpen] = useState(false);
  const [settlementAccountCode, setSettlementAccountCode] = useState('11-1201');
  const [settlementAmount, setSettlementAmount] = useState('');
  // Client-generated per-dialog-open UUID — dedupe key for shop-collect
  // settlement retries without swallowing an intentional same-amount repeat.
  const [settlementRequestId, setSettlementRequestId] = useState('');
  const canSettlement = ['OWNER', 'FINANCE_MANAGER', 'ACCOUNTANT'].includes(user?.role ?? '');

  const {
    data: preview, isLoading: previewLoading, isFetching: previewFetching,
    isError: previewFailed, error: previewError, refetch: retryPreview,
  } = useQuery<RepoPreview>({
    queryKey: [
      'repossession-preview',
      contractId,
      conditionGrade,
      appraisalPrice,
      discountPct,
      depositAccountCode,
      collectedByShop,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (appraisalPrice) params.set('appraisalPrice', appraisalPrice);
      if (discountPct) params.set('discountPct', discountPct);
      // JOURNAL AUTO dry-run — mirror ตอน create: collectedByShop → Dr 11-2107
      params.set('depositAccountCode', depositAccountCode);
      params.set('collectedByShop', String(collectedByShop));
      // เกรด → backend ค้นตารางรับซื้อมือสองให้เป็นราคากลางแนะนำ
      params.set('conditionGrade', conditionGrade);
      const { data } = await api.get(`/repossessions/preview/${contractId}?${params.toString()}`);
      return data;
    },
    enabled: canPreview && !!contractId,
    // Eligibility and ledger balances can change while this dialog is closed.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // ผลทางบัญชี (ledger) — คู่กับ calculation.profitLoss เชิงบริหาร (คำสั่งเจ้าของ 2026-08-08 ข้อ 1)
  const ledgerPl = useMemo(() => computeLedgerPl(preview?.journalPreview), [preview]);

  // ราคาตารางรับซื้อ (เกรดที่เลือก) → เติมราคาประเมินเป็นค่าตั้งต้นเฉพาะเมื่อช่องว่างหรือยังเป็น
  // ค่าที่ระบบเติมไว้ก่อนหน้า; เปลี่ยนเกรดแล้วไม่พบ → ล้างค่าที่ระบบเติม (ค่าที่พิมพ์เองคงไว้)
  const valuation = preview?.valuation;
  useEffect(() => {
    if (!valuation || valuation.grade !== conditionGrade) return;
    if (valuation.found && valuation.suggestedPrice != null) {
      const s = String(valuation.suggestedPrice);
      if (s === autoPrice) return;
      setAppraisalPrice((cur) => (cur === '' || cur === autoPrice ? s : cur));
      setAutoPrice(s);
    } else if (autoPrice !== null) {
      setAppraisalPrice((cur) => (cur === autoPrice ? '' : cur));
      setAutoPrice(null);
    }
  }, [valuation, conditionGrade, autoPrice]);

  // ด่านตารางรับซื้อ (ตัวเลขชุดเดียวกับหน้ารับซื้อ ±15%): ต่างเกิน → ต้องระบุเหตุผลในหมายเหตุ
  // server บังคับซ้ำใน create() — ที่นี่แค่บอกล่วงหน้าและกันกดยืนยันโดยยังไม่มีเหตุผล
  const tablePrice =
    valuation?.found && valuation.grade === conditionGrade ? valuation.suggestedPrice : null;
  const appraisalForDeviation = Number(appraisalPrice);
  const deviationPct =
    tablePrice && tablePrice > 0 && appraisalForDeviation > 0
      ? ((appraisalForDeviation - tablePrice) / tablePrice) * 100
      : null;
  const needsReason = deviationPct !== null && Math.abs(deviationPct) > 15;
  const reasonMissing = needsReason && notes.trim().length === 0;
  const blockedByEligibility = preview?.eligibility?.canRepossess === false;
  const deviationLabel =
    deviationPct === null ? '' : `${deviationPct > 0 ? '+' : ''}${deviationPct.toFixed(0)}%`;

  const mutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/repossessions', {
        contractId,
        repossessedDate,
        conditionGrade,
        appraisalPrice: Number(appraisalPrice),
        repairCost: repairCost ? Number(repairCost) : 0,
        notes: notes || undefined,
        returnReason,
        discountPct: discountPct ? Number(discountPct) : 50,
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
        requestId: settlementRequestId,
      });
      return data;
    },
    onSuccess: () => {
      toast.success('บันทึกรับโอนจากหน้าร้านสำเร็จ');
      queryClient.invalidateQueries({ queryKey: ['repossession-preview', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contract', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['repossessions'] });
      setSettlementOpen(false);
      setSettlementAmount('');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const appraisalNum = Number(appraisalPrice);
  const submitBlockReason = !canCreate ? 'เฉพาะเจ้าของ (OWNER) ยืนยันยึดคืนได้'
    : blockedByEligibility ? preview?.eligibility?.reason || 'สัญญานี้ยังยึดคืนไม่ได้'
    : previewLoading || previewFetching ? 'กำลังตรวจสอบยอดและรายการ JP5'
    : previewFailed ? 'ตรวจสอบข้อมูลไม่สำเร็จ กรุณาลองคำนวณใหม่'
    : !preview || preview.eligibility?.canRepossess !== true ? 'ยังตรวจสอบสถานะสัญญาไม่สำเร็จ'
    : !repossessedDate ? 'กรุณาระบุวันที่ยึดคืน'
    : !Number.isFinite(appraisalNum) || appraisalNum <= 0 ? 'กรุณาระบุราคาประเมินมากกว่า 0'
    : !Number.isFinite(Number(repairCost)) || Number(repairCost) < 0 ? 'ค่าซ่อมต้องไม่ติดลบ'
    : discountPct !== '' && (!Number.isFinite(Number(discountPct)) || Number(discountPct) < 0 || Number(discountPct) > 100) ? 'ส่วนลดยอดปิดต้องอยู่ระหว่าง 0 ถึง 100%'
    : paymentDate && (paymentDate > bkkToday() || paymentDate.slice(0, 7) !== bkkToday().slice(0, 7)) ? 'วันที่รับเงินต้องอยู่ในเดือนปัจจุบันและไม่เป็นวันในอนาคต'
    : !returnReason ? 'กรุณาเลือกเหตุผลคืนเครื่อง'
    : returnReason === 'OTHER' && !notes.trim() ? 'กรุณาระบุรายละเอียดเหตุผลคืนเครื่อง'
    : reasonMissing ? 'กรุณาอธิบายเหตุผลที่ราคาประเมินต่างจากตารางเกิน 15% ในรายละเอียดเพิ่มเติม'
    : !preview.journalPreview ? 'ยังไม่มีรายการ JP5 ให้ตรวจสอบ กรุณาลองคำนวณใหม่'
    : !preview.journalPreview.isBalanced ? 'รายการ JP5 ยังไม่สมดุล กรุณาตรวจสอบก่อนยืนยัน'
    : mutation.isPending ? 'กำลังบันทึกการยึดคืน' : null;
  const canSubmit = submitBlockReason === null;
  const hasReceivableRelief = preview?.journalPreview?.lines.some((line) =>
    ['11-2101', '11-2103', '11-2105'].includes(line.accountCode) && Number(line.credit) > 0,
  );
  const hasVatCreditNote = preview?.journalPreview?.lines.some((line) =>
    line.accountCode === '21-2101' && Number(line.debit) > 0,
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

        {/* ยึดไม่ได้ (strict mode / สถานะสัญญา) — บอกตั้งแต่เปิด ไม่รอชน 400 ตอนยืนยัน (2026-09-05) */}
        {blockedByEligibility && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning leading-snug"
          >
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <span>{preview?.eligibility?.reason}</span>
          </div>
        )}

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
                {valuation && valuation.grade === conditionGrade && (
                  <p
                    className={`mt-1 text-[11px] leading-snug ${
                      reasonMissing
                        ? 'text-destructive'
                        : valuation.found
                          ? 'text-muted-foreground'
                          : 'text-warning'
                    }`}
                  >
                    {!valuation.found
                      ? `ไม่มีรุ่นนี้ในตารางรับซื้อ (เกรด ${valuation.grade}) ตีราคาเอง`
                      : reasonMissing
                        ? `ต่างจากตารางรับซื้อ ${deviationLabel} (เกิน 15%) — ต้องระบุเหตุผลในหมายเหตุก่อนยืนยัน`
                        : `ตารางรับซื้อ เกรด ${valuation.grade}: ${formatNumberDecimal(valuation.suggestedPrice ?? 0, 2)} ฿` +
                          (appraisalPrice === autoPrice
                            ? ' (ค่าตั้งต้น ปรับตามสภาพจริงได้)'
                            : deviationLabel
                              ? ` · ต่างจากตาราง ${deviationLabel}`
                              : '')}
                  </p>
                )}
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
          subtitle="ส่วนลดยอดปิด — ราคาประเมิน − ยอดปิดสัญญา"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
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
            {/* Live breakdown */}
            {!canPreview ? (
              <div className="py-6 text-center text-sm leading-snug text-muted-foreground">
                ดูตัวอย่าง P&L ได้เฉพาะ OWNER / ผจก.สาขา / ผจก.การเงิน
              </div>
            ) : previewFailed ? (
              <div role="alert" className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive">
                <p>คำนวณตัวอย่างไม่สำเร็จ: {getErrorMessage(previewError)}</p>
                <button type="button" onClick={() => retryPreview()} className="mt-2 underline">ลองคำนวณใหม่</button>
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
                {(preview.calculation.rescheduleAdvanceApplied ?? 0) > 0 && (
                  <Row
                    label="หักเงินรับล่วงหน้าที่พักไว้"
                    value={`- ${formatNumberDecimal(preview.calculation.rescheduleAdvanceApplied!)} ฿`}
                  />
                )}
                <div className="border-t border-border pt-2">
                  <Row
                    label="ยอดปิดสัญญาสุทธิ"
                    value={`${preview.calculation.closingAmount.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`}
                    bold
                  />
                </div>
                <div className="border-t border-border pt-2 space-y-2">
                  <Row
                    label="ราคาประเมิน (หน้าร้านรับเครื่อง)"
                    value={
                      preview.calculation.marketValueSource === null
                        ? '—'
                        : `${preview.calculation.marketValue.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ฿`
                    }
                  />
                </div>
                {preview.calculation.marketValueSource === null ? (
                  <div className="mt-2 p-3 rounded-lg bg-muted text-xs text-muted-foreground leading-snug">
                    กรอกราคาประเมินก่อน จึงจะคำนวณกำไร/ขาดทุนเชิงบริหารได้
                  </div>
                ) : (
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
                            ส่วนต่างราคาประเมินเทียบยอดปิด
                          </>
                        ) : (
                          <>
                            <X className="size-4 inline mr-1" />
                            ส่วนต่างราคาประเมินเทียบยอดปิด
                          </>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground leading-snug">
                        ราคาประเมิน − ยอดปิดสัญญา
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
                )}
                {/* คำสั่งเจ้าของ 2026-08-08 (ข้อ 1): โชว์เลขบัญชีคู่กับเลขบริหาร — สองเลขต่างกันได้
                    (ส่วนลด/ราคากลาง อยู่เฉพาะมุมมองบริหาร; บัญชีรับรู้จากราคาตี + เงินคืน) */}
                {preview.journalPreview && (
                  <div className="text-xs mt-2 px-3 space-y-2">
                    <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground leading-snug">
                      กำไร/ขาดทุนจากรายการยึดคืน
                    </span>
                    <span className="font-medium text-foreground">
                      {ledgerPl >= 0 ? '+' : ''}
                      {ledgerPl.toLocaleString('th-TH', {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })}{' '}
                      ฿
                    </span>
                    </div>
                    <p className="text-muted-foreground leading-relaxed">
                      อ่านจากบัญชีกำไร/ขาดทุนจากการยึดใน JP5 หลังล้างยอดคงเหลือทางบัญชี
                      ตัวเลขนี้ใช้ฐานบัญชี ส่วนต่างด้านบนใช้ยอดปิดสัญญาหลังส่วนลด
                    </p>
                    {!hasReceivableRelief && (
                      <p className="text-warning leading-relaxed">
                        JP5 ชุดนี้ไม่มีบรรทัดตัดลูกหนี้ ยอดจึงรวมมูลค่ารับคืนและเงินล่วงหน้าที่ล้างออก
                        ควรตรวจประวัติบัญชีของสัญญาประกอบ
                      </p>
                    )}
                  </div>
                )}
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
            <p className="text-xs text-muted-foreground leading-snug mt-1">
              ย้อนหลังได้ภายในเดือนนี้เท่านั้น
            </p>
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
          title="เหตุผลคืนเครื่อง"
          subtitle="เลือกเหตุผลและบันทึกรายละเอียดประกอบ"
        >
          <label htmlFor="repo-return-reason" className="block text-xs font-medium mb-1.5">
            เหตุผลคืนเครื่อง <span className="text-destructive">*</span>
          </label>
          <select id="repo-return-reason" value={returnReason} onChange={(e) => setReturnReason(e.target.value)} className={inputClass} required>
            <option value="">— เลือกเหตุผลคืนเครื่อง —</option>
            {RETURN_REASONS.map((reason) => <option key={reason.value} value={reason.value}>{reason.label}</option>)}
          </select>
          <label htmlFor="repo-return-notes" className="block text-xs font-medium mt-3 mb-1.5">
            รายละเอียดเพิ่มเติม {(returnReason === 'OTHER' || needsReason) ? <span className="text-destructive">*</span> : '(ถ้ามี)'}
          </label>
          <textarea
            id="repo-return-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className={`${inputClass} resize-none`}
            placeholder="เช่น สภาพเครื่อง หรือเหตุผลที่ราคาประเมินต่างจากตาราง..."
          />
          {needsReason && <p className="text-xs text-warning mt-1">กรุณาอธิบายเหตุผลที่ราคาประเมินต่างจากตารางเกิน 15% เพิ่มเติมจากเหตุผลคืนเครื่อง</p>}
        </Section>

        {/* Section 5.5: JOURNAL AUTO — JP5 JE preview (dry-run บรรทัดเดียวกับตอน post) */}
        {canPreview && preview?.journalPreview && (
          <Section
            icon={<FileText className="size-4" />}
            title="รายการบัญชีคืนเครื่อง (JP5)"
            subtitle={hasVatCreditNote ? 'ยึดเครื่องและกลับรายการ VAT พร้อมออกใบลดหนี้' : 'รายการที่จะลงบัญชีเมื่อยืนยันยึดคืน'}
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
        {canPreview && !previewLoading && !previewFetching && !previewFailed && preview && !preview.journalPreview && (
          <Section icon={<FileText className="size-4" />} title="รายการบัญชีคืนเครื่อง (JP5)" subtitle="ยังไม่มีรายการให้ตรวจสอบ">
            <p className="text-sm text-warning">ไม่สามารถเตรียมรายการ JP5 ได้ กรุณาตรวจสอบข้อมูลบัญชีของสัญญาแล้วลองอีกครั้ง</p>
            <button type="button" onClick={() => retryPreview()} className="mt-2 text-sm underline">ลองคำนวณใหม่</button>
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
            <Effect text={hasVatCreditNote ? 'ปิดลูกหนี้คงค้างและออกใบลดหนี้ VAT — บันทึก JP5' : 'ปิดรายการคงค้างของสัญญาตามรายการบัญชี JP5 ด้านบน'} />
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
      <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 space-y-3">
        {submitBlockReason && (
          <div id="repo-submit-block" role="status" className="text-sm text-warning leading-snug">
            <p>{submitBlockReason}</p>
            {blockedByEligibility && <a href={`/contracts/${contractId}`} className="inline-block mt-1 underline">เปิดสัญญาเพื่อตรวจสถานะและหนังสือบอกเลิก</a>}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
        {/* Settlement button — visible to OWNER / FINANCE_MANAGER / ACCOUNTANT (mirror ปิดยอด) */}
        {canSettlement ? (
          <button
            type="button"
            onClick={() => {
              setSettlementRequestId(crypto.randomUUID());
              setSettlementOpen(true);
            }}
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
            title={submitBlockReason ?? undefined}
            aria-describedby={submitBlockReason ? 'repo-submit-block' : undefined}
            className="px-6 py-2.5 text-sm leading-snug bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm"
          >
            {mutation.isPending ? 'กำลังบันทึก...' : 'ยืนยันยึดคืน'}
          </button>
        </div>
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
