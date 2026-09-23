import { useMemo, useRef, useState } from 'react';
import { WizardStackedOverlay } from '@/components/WizardStackedOverlay';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  PackageX,
  ClipboardCheck,
  Calculator,
  CalendarDays,
  FileText,
  Check,
  X,
  AlertTriangle,
  Lock,
} from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { formatDateShort, formatNumberDecimal } from '@/utils/formatters';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Effect, Row, Section } from '@/components/device-returns/FormSection';
import { RejectDeviceReturnDialog } from '@/components/device-returns/RejectDeviceReturnDialog';
import {
  bkkToday,
  computeDeviationPct,
  formatDeviationLabel,
  DEVICE_RETURN_CONFIRM_ROLES,
  DEVICE_RETURN_PREVIEW_ROLES,
  DEVICE_RETURN_KIND_LABEL,
  DEVICE_RETURN_STATUS_LABEL,
  LINE_STATUS_LABEL,
  RETURN_REASON_LABEL,
  TABLE_DEVIATION_LIMIT_PCT,
  type DeviceReturnRow,
  type LineNotifyStatus,
} from '@/components/device-returns/types';

interface Props {
  /** ใบรับเครื่องคืนที่จะยืนยัน — overlay เป็น "โหมดยืนยัน" อย่างเดียวตั้งแต่ 2026-09-20 (POST /repossessions ถูกลบ) */
  deviceReturnId: string;
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
    /** ค่างวด × งวดคงเหลือ ก่อนหักยอดชำระล่วงหน้า/ถังพัก (optional — API เก่าไม่ส่ง) */
    totalRemaining?: number;
    /** creditBalance + งวดจ่ายบางส่วน */
    advancePayment?: number;
    /** ยอดค้างหลังหักยอดชำระล่วงหน้าและค่าปรับดิวที่พักไว้แล้ว */
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
    /** ที่มาของราคาประเมิน — null = ยังคำนวณไม่ได้ */
    marketValueSource: 'MARKET' | 'APPRAISAL' | null;
    customerRefundEnabled?: boolean;
    customerRefund?: number;
    profitLoss: number;
  };
  /** ยืนยันได้ไหม ณ ตอนนี้ (สถานะสัญญา + strict mode + ยอดค้าง) — กติกาเดียวกับ createInTx */
  eligibility?: { canRepossess: boolean; reason: string | null } | null;
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

const LINE_BADGE: Record<LineNotifyStatus, 'success' | 'destructive' | 'warning'> = {
  SENT: 'success',
  FAILED: 'destructive',
  NO_LINE: 'warning',
};

/**
 * ผลทางบัญชี (ledger P&L) จาก JP5 journalPreview — คำสั่งเจ้าของ 2026-08-08 (ข้อ 1):
 * โชว์คู่กับ "กำไร/ขาดทุนเชิงบริหาร" (calculation.profitLoss ซึ่งมีส่วนลด/ราคาประเมิน)
 * เพราะสองเลขนี้ต่างกันได้โดยตั้งใจ. อ่านตรงจากบรรทัด JE: 41-1102 (Cr) = กำไรจากการยึดสินค้า,
 * 51-1102 (Dr) = ขาดทุนจากยึดเครื่อง.
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

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 outline-hidden';

/**
 * ยืนยันใบรับเครื่องคืน (JP5 + ขาคู่ SHOP) — spec 2026-09-20 §5.2, §7. โหมดยืนยันอย่างเดียว:
 * ข้อมูลใบ (เกรด/ราคาประเมิน/เหตุผล/สาขา) อ่านอย่างเดียวจากใบที่สาขาบันทึก; FINANCE แก้ได้เฉพาะ
 * วันที่ลงบัญชี + ส่วนลดยอดปิด. ยืนยัน = `POST /device-returns/:id/confirm` (server เรียก
 * `RepossessionsService.createInTx` — ขา Dr JP5 = 11-2107 stamp DEVICE_RETURN เสมอ).
 * Roles: ยืนยัน/ส่งกลับ = OWNER / FINANCE_MANAGER; preview = ทุก role (เจ้าของ 2026-09-23 —
 * "คนอื่นคำนวณได้ แต่ผู้จัดการอนุมัติทีหลัง"; role ที่ยืนยันไม่ได้เห็นตัวเลขแบบอ่านอย่างเดียว).
 */
export function RepossessionOverlay({
  deviceReturnId,
  contractId,
  contractNumber,
  customerName,
  branchName,
  onClose,
  onSuccess,
}: Props) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canPreview = DEVICE_RETURN_PREVIEW_ROLES.includes(user?.role ?? '');
  const canConfirm = DEVICE_RETURN_CONFIRM_ROLES.includes(user?.role ?? '');

  const [discountPct, setDiscountPct] = useState('50');
  // วันที่ลงบัญชี (JP5 + ขาคู่ SHOP) — ย้อนหลังได้ภายในเดือนปัจจุบัน (กติกาใบลดหนี้เดิม)
  const [paymentDate, setPaymentDate] = useState(bkkToday);
  const [rejectOpen, setRejectOpen] = useState(false);
  const submitting = useRef(false);

  const {
    data: deviceReturn,
    isLoading: drLoading,
    isFetching: drFetching,
    isError: drFailed,
    error: drError,
    refetch: retryDr,
  } = useQuery<DeviceReturnRow>({
    queryKey: ['device-returns', 'detail', deviceReturnId],
    queryFn: async () => (await api.get(`/device-returns/${deviceReturnId}`)).data,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const {
    data: preview,
    isLoading: previewLoading,
    isFetching: previewFetching,
    isError: previewFailed,
    error: previewError,
    refetch: retryPreview,
  } = useQuery<RepoPreview>({
    queryKey: ['repossession-preview', contractId, deviceReturnId, discountPct],
    queryFn: async () => {
      // โหมดยืนยัน: เกรด/ราคาประเมิน/เหตุผลมาจากใบรับเครื่องคืนฝั่ง server —
      // ส่งแค่ deviceReturnId + ส่วนลด (ไม่มี conditionGrade/appraisalPrice/collectedByShop อีก)
      const params = new URLSearchParams({ deviceReturnId });
      if (discountPct) params.set('discountPct', discountPct);
      const { data } = await api.get(`/repossessions/preview/${contractId}?${params.toString()}`);
      return data;
    },
    enabled: canPreview && !!contractId,
    // ยอดค้าง/สถานะเปลี่ยนได้ระหว่างที่ overlay ปิด (ลูกค้าจ่ายผ่าน webhook)
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const ledgerPl = useMemo(() => computeLedgerPl(preview?.journalPreview), [preview]);
  const blockedByEligibility = preview?.eligibility?.canRepossess === false;
  const notPending = !!deviceReturn && deviceReturn.status !== 'PENDING_CONFIRM';
  const tableBase =
    deviceReturn?.tableBasePrice != null ? Number(deviceReturn.tableBasePrice) : null;
  const deviationPct = deviceReturn
    ? computeDeviationPct(Number(deviceReturn.appraisalPrice), tableBase)
    : null;
  const deviationLabel = formatDeviationLabel(deviationPct);
  const overLimit = deviationPct !== null && Math.abs(deviationPct) > TABLE_DEVIATION_LIMIT_PCT;

  const mutation = useMutation({
    retry: false,
    mutationFn: async () => {
      const { data } = await api.post(`/device-returns/${deviceReturnId}/confirm`, {
        // Cleared input = '' → omit so the server defaults to today
        paymentDate: paymentDate || undefined,
        discountPct: discountPct ? Number(discountPct) : 50,
      });
      return data;
    },
    onSuccess: () => {
      toast.success(
        'ยืนยันรับเครื่องคืนแล้ว — ลงบัญชี JP5 + ขาคู่ SHOP เรียบร้อย ค่าเครื่องรอหักในรอบจ่าย INTER-CO',
      );
      queryClient.invalidateQueries({ queryKey: ['device-returns'] });
      queryClient.invalidateQueries({ queryKey: ['contract', contractId] });
      queryClient.invalidateQueries({ queryKey: ['contracts'] });
      queryClient.invalidateQueries({ queryKey: ['repossessions'] });
      queryClient.invalidateQueries({ queryKey: ['repossessions-pl'] });
      queryClient.invalidateQueries({ queryKey: ['interco-pending'] });
      queryClient.invalidateQueries({ queryKey: ['customer-tags'] });
      onSuccess();
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
    onSettled: () => {
      submitting.current = false;
    },
  });

  const computeBlockReason = (): string | null => {
    if (!canConfirm) return 'เฉพาะเจ้าของ / ผจก.การเงิน ยืนยันรับเครื่องคืนได้';
    if (drLoading || drFetching) return 'กำลังโหลดใบรับเครื่องคืน';
    if (drFailed) return 'โหลดใบรับเครื่องคืนไม่สำเร็จ กรุณาลองใหม่';
    if (!deviceReturn) return 'ยังโหลดใบรับเครื่องคืนไม่สำเร็จ';
    if (notPending) return 'ใบนี้ถูกยืนยัน/ส่งกลับ/ยกเลิกไปแล้ว';
    if (blockedByEligibility) return preview?.eligibility?.reason || 'สัญญานี้ยังยึดคืนไม่ได้';
    if (previewLoading || previewFetching) return 'กำลังตรวจสอบยอดและรายการ JP5';
    if (previewFailed) return 'ตรวจสอบข้อมูลไม่สำเร็จ กรุณาลองคำนวณใหม่';
    if (!preview || preview.eligibility?.canRepossess !== true) {
      return 'ยังตรวจสอบสถานะสัญญาไม่สำเร็จ';
    }
    if (
      discountPct !== '' &&
      (!Number.isFinite(Number(discountPct)) ||
        Number(discountPct) < 0 ||
        Number(discountPct) > 100)
    ) {
      return 'ส่วนลดยอดปิดต้องอยู่ระหว่าง 0 ถึง 100%';
    }
    if (
      paymentDate &&
      (paymentDate > bkkToday() || paymentDate.slice(0, 7) !== bkkToday().slice(0, 7))
    ) {
      return 'วันที่ลงบัญชีต้องอยู่ในเดือนปัจจุบันและไม่เป็นวันในอนาคต';
    }
    if (!preview.journalPreview) return 'ยังไม่มีรายการ JP5 ให้ตรวจสอบ กรุณาลองคำนวณใหม่';
    if (!preview.journalPreview.isBalanced) return 'รายการ JP5 ยังไม่สมดุล กรุณาตรวจสอบก่อนยืนยัน';
    if (mutation.isPending) return 'กำลังยืนยันรับเครื่องคืน';
    if (mutation.isSuccess) return 'ยืนยันรับเครื่องคืนแล้ว';
    if (rejectOpen) return 'กรุณาปิดหน้าส่งกลับก่อนยืนยัน';
    return null;
  };
  const submitBlockReason = computeBlockReason();
  const canSubmit = submitBlockReason === null;
  const hasReceivableRelief = preview?.journalPreview?.lines.some(
    (line) =>
      ['11-2101', '11-2103', '11-2105'].includes(line.accountCode) && Number(line.credit) > 0,
  );
  const hasVatCreditNote = preview?.journalPreview?.lines.some(
    (line) => line.accountCode === '21-2101' && Number(line.debit) > 0,
  );

  return (
    <WizardStackedOverlay maxWidthClass="max-w-2xl">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between">
        <button
          disabled={mutation.isPending || rejectOpen}
          onClick={() => !submitting.current && !rejectOpen && onClose()}
          className="flex items-center gap-1.5 text-sm leading-snug text-muted-foreground hover:text-foreground transition-colors"
        >
          ← กลับ
        </button>
        <h2 className="text-lg font-semibold text-foreground leading-snug">
          ยืนยันรับเครื่องคืน (JP5)
        </h2>
        <div className="w-16" />
      </div>

      <div className="p-6 space-y-5">
        {!canConfirm && (
          <div className="flex items-start gap-2.5 rounded-lg border border-warning/40 bg-warning/10 px-3 py-3">
            <Lock className="size-4 text-warning-strong shrink-0 mt-0.5" />
            <div className="text-xs text-warning-strong leading-snug">
              <strong className="block">การยืนยันทำได้เฉพาะเจ้าของ / ผจก.การเงิน</strong>
              {canPreview
                ? 'ดูตัวอย่างกำไร/ขาดทุนและรายการ JP5 ได้ แต่กดยืนยันไม่ได้'
                : 'บทบาทนี้ดูตัวอย่าง P&L และยืนยันไม่ได้'}
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
                <span className="text-muted-foreground">สาขาที่รับ: </span>
                <span className="font-medium">{branchName}</span>
              </div>
            )}
          </div>
        </Section>

        {/* Section 2: ใบรับเครื่องคืน — อ่านอย่างเดียว (สาขาบันทึก) */}
        <Section
          icon={<ClipboardCheck className="size-4" />}
          title="ใบรับเครื่องคืน"
          subtitle="ข้อมูลจากสาขา — อ่านอย่างเดียว (แก้ = ส่งกลับให้สาขาบันทึกใหม่)"
        >
          {drLoading ? (
            <p className="text-sm text-muted-foreground leading-snug">กำลังโหลด...</p>
          ) : drFailed ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
            >
              <p>โหลดใบรับเครื่องคืนไม่สำเร็จ: {getErrorMessage(drError)}</p>
              <button type="button" onClick={() => retryDr()} className="mt-2 underline">
                ลองใหม่
              </button>
            </div>
          ) : deviceReturn ? (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">เลขที่ใบ: </span>
                <span className="font-mono font-semibold">{deviceReturn.docNumber}</span>
              </div>
              <div>
                <span className="text-muted-foreground">ประเภท: </span>
                <Badge
                  variant={deviceReturn.returnKind === 'REPOSSESSION' ? 'destructive' : 'warning'}
                  appearance="light"
                  size="sm"
                >
                  {DEVICE_RETURN_KIND_LABEL[deviceReturn.returnKind]}
                </Badge>
              </div>
              <div>
                <span className="text-muted-foreground">วันที่รับเครื่อง: </span>
                <span className="font-medium">
                  {formatDateShort(deviceReturn.deviceReceivedAt)}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">สาขาที่รับ: </span>
                <span className="font-medium">{deviceReturn.receivingBranch.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">ผู้ตรวจ/ตีราคา: </span>
                <span className="font-medium">{deviceReturn.receivedBy.name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">เหตุผล: </span>
                <span className="font-medium">
                  {RETURN_REASON_LABEL[deviceReturn.returnReason]}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">เกรดสภาพ: </span>
                <span className="font-semibold">{deviceReturn.conditionGrade}</span>
              </div>
              <div>
                <span className="text-muted-foreground">ราคาประเมิน: </span>
                <span className="font-mono font-semibold" data-testid="dr-appraisal">
                  {formatNumberDecimal(deviceReturn.appraisalPrice, 2)} ฿
                </span>
                <span
                  className={`block text-[11px] leading-snug ${
                    tableBase === null ? 'text-warning-strong' : 'text-muted-foreground'
                  }`}
                >
                  {tableBase === null
                    ? 'ไม่มีรุ่นนี้ในตารางรับซื้อ — สาขาตีราคาเอง'
                    : `ตารางรับซื้อ ${formatNumberDecimal(tableBase, 2)} ฿` +
                      (deviationLabel ? ` · ต่างจากตาราง ${deviationLabel}` : '') +
                      (overLimit ? ' (เกิน 15% — สาขาระบุเหตุผลในหมายเหตุแล้ว)' : '')}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">ค่าซ่อม: </span>
                <span className="font-mono">
                  {formatNumberDecimal(deviceReturn.repairCost, 2)} ฿
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">ไลน์แจ้งลูกค้า: </span>
                {deviceReturn.lineNotifyStatus ? (
                  <Badge
                    variant={LINE_BADGE[deviceReturn.lineNotifyStatus]}
                    appearance="light"
                    size="sm"
                  >
                    {LINE_STATUS_LABEL[deviceReturn.lineNotifyStatus]}
                  </Badge>
                ) : (
                  <Badge variant="secondary" appearance="light" size="sm">
                    ยังไม่ส่ง
                  </Badge>
                )}
              </div>
              {deviceReturn.notes && (
                <div className="col-span-2">
                  <span className="text-muted-foreground">หมายเหตุ: </span>
                  <span>{deviceReturn.notes}</span>
                </div>
              )}
            </div>
          ) : null}
          {notPending && deviceReturn && (
            <div
              role="alert"
              className="mt-3 flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-strong leading-snug"
            >
              <AlertTriangle className="size-4 mt-0.5 shrink-0" />
              <span>
                ใบนี้ถูกยืนยัน/ส่งกลับ/ยกเลิกไปแล้ว (
                {DEVICE_RETURN_STATUS_LABEL[deviceReturn.status]})
              </span>
            </div>
          )}
        </Section>

        {/* ยึดไม่ได้ (ยอดค้าง 0 / สถานะ / เครื่องเคยยึด) — บอกตั้งแต่เปิด ไม่รอชน 400 */}
        {blockedByEligibility && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-sm text-warning-strong leading-snug"
          >
            <AlertTriangle className="size-4 mt-0.5 shrink-0" />
            <span>{preview?.eligibility?.reason}</span>
          </div>
        )}

        {/* Section 3: คำนวณกำไร/ขาดทุน — ส่วนลดยอดปิด (ตัวเลขบนจอ ไม่ลง JE) */}
        <Section
          icon={<Calculator className="size-4" />}
          title="คำนวณกำไร/ขาดทุน (FINANCE)"
          subtitle="ส่วนลดยอดปิด — ราคาประเมิน − ยอดปิดสัญญา"
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="repo-discount-pct"
                  className="block text-xs font-medium text-foreground mb-1.5 leading-snug"
                >
                  ส่วนลดยอดปิด (%)
                </label>
                <input
                  id="repo-discount-pct"
                  type="number"
                  min={0}
                  max={100}
                  value={discountPct}
                  disabled={mutation.isPending || rejectOpen}
                  onChange={(e) => setDiscountPct(e.target.value)}
                  className={`${inputClass} text-right font-mono`}
                  placeholder="50"
                />
              </div>
            </div>
            {!canPreview ? (
              <div className="py-6 text-center text-sm leading-snug text-muted-foreground">
                บัญชีนี้ไม่มีสิทธิ์ดูตัวอย่าง P&L
              </div>
            ) : previewFailed ? (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
              >
                <p>คำนวณตัวอย่างไม่สำเร็จ: {getErrorMessage(previewError)}</p>
                <button type="button" onClick={() => retryPreview()} className="mt-2 underline">
                  ลองคำนวณใหม่
                </button>
              </div>
            ) : previewLoading || !preview ? (
              <div className="py-6 text-center text-sm leading-snug text-muted-foreground">
                กำลังคำนวณ...
              </div>
            ) : (
              <div className="rounded-xl bg-muted/60 p-4 space-y-2">
                {/* ค่าปรับดิวที่พักไว้หักออกจากยอดค้าง "ก่อน" คิดฐานส่วนลด (เจ้าของ 2026-09-23)
                    — outstandingBalance เป็นยอดหลังหักแล้ว จึงไล่บรรทัดหักไว้เหนือมัน */}
                {((preview.calculation.advancePayment ?? 0) > 0 ||
                  (preview.calculation.rescheduleAdvanceApplied ?? 0) > 0) &&
                  preview.calculation.totalRemaining != null && (
                    <Row
                      label="รวมค้างชำระ (รวม VAT)"
                      value={`${formatNumberDecimal(preview.calculation.totalRemaining)} ฿`}
                    />
                  )}
                {(preview.calculation.advancePayment ?? 0) > 0 && (
                  <Row
                    label="ยอดชำระล่วงหน้า"
                    value={`- ${formatNumberDecimal(preview.calculation.advancePayment!)} ฿`}
                  />
                )}
                {(preview.calculation.rescheduleAdvanceApplied ?? 0) > 0 && (
                  <Row
                    label="หักเงินรับล่วงหน้าที่พักไว้"
                    value={`- ${formatNumberDecimal(preview.calculation.rescheduleAdvanceApplied!)} ฿`}
                  />
                )}
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
                        <Check className="size-4 inline mr-1" />
                      ) : (
                        <X className="size-4 inline mr-1" />
                      )}
                      ส่วนต่างราคาประเมินเทียบยอดปิด
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
                      <p className="text-warning-strong leading-relaxed">
                        JP5 ชุดนี้ไม่มีบรรทัดตัดลูกหนี้
                        ยอดจึงรวมมูลค่ารับคืนและเงินล่วงหน้าที่ล้างออก
                        ควรตรวจประวัติบัญชีของสัญญาประกอบ
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </Section>

        {/* Section 4: วันที่ลงบัญชี — แทนส่วน "รับชำระ" เดิม (ไม่มีขาเงินสดวันยึดอีกต่อไป) */}
        <Section
          icon={<CalendarDays className="size-4" />}
          title="วันที่ลงบัญชี"
          subtitle="JP5 + ขาคู่ SHOP ลงวันที่นี้ — ค่าเครื่องตั้งเป็นลูกหนี้-หน้าร้าน 11-2107 ไม่มีขาเงินสด"
          tone="warning"
        >
          <label
            htmlFor="repo-payment-date"
            className="block text-xs font-medium text-foreground mb-1.5"
          >
            วันที่ลงบัญชี{' '}
            <span className="text-muted-foreground font-normal">
              (ย้อนหลังได้ถ้างวดบัญชียังเปิด)
            </span>
          </label>
          <input
            id="repo-payment-date"
            type="date"
            value={paymentDate}
            max={bkkToday()}
            disabled={mutation.isPending || rejectOpen}
            onChange={(e) => setPaymentDate(e.target.value)}
            className={`${inputClass} font-mono`}
          />
          <p className="text-xs text-muted-foreground leading-snug mt-1">
            ย้อนหลังได้ภายในเดือนนี้เท่านั้น — ใบที่ข้ามเดือนจะได้ JE/ใบลดหนี้ของเดือนที่ยืนยัน
          </p>
        </Section>

        {/* Section 5: JOURNAL AUTO — JP5 JE preview (dry-run บรรทัดเดียวกับตอน post) */}
        {canPreview && preview?.journalPreview && (
          <Section
            icon={<FileText className="size-4" />}
            title="รายการบัญชีคืนเครื่อง (JP5)"
            subtitle={
              hasVatCreditNote
                ? 'ยึดเครื่องและกลับรายการ VAT พร้อมออกใบลดหนี้'
                : 'รายการที่จะลงบัญชีเมื่อยืนยันรับเครื่องคืน'
            }
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
        {canPreview &&
          !previewLoading &&
          !previewFetching &&
          !previewFailed &&
          preview &&
          !preview.journalPreview && (
            <Section
              icon={<FileText className="size-4" />}
              title="รายการบัญชีคืนเครื่อง (JP5)"
              subtitle="ยังไม่มีรายการให้ตรวจสอบ"
            >
              <p className="text-sm text-warning-strong">
                ไม่สามารถเตรียมรายการ JP5 ได้ กรุณาตรวจสอบข้อมูลบัญชีของสัญญาแล้วลองอีกครั้ง
              </p>
              <button
                type="button"
                onClick={() => retryPreview()}
                className="mt-2 text-sm underline"
              >
                ลองคำนวณใหม่
              </button>
            </Section>
          )}

        {/* Section 6: สิ่งที่จะเกิดขึ้น */}
        <Section
          icon={<Check className="size-4" />}
          title="สิ่งที่จะเกิดขึ้นเมื่อยืนยัน"
          subtitle="ตรวจสอบก่อนยืนยัน"
          tone="success"
        >
          <ul className="space-y-1.5 text-sm">
            <Effect
              text={
                hasVatCreditNote
                  ? 'ปิดลูกหนี้คงค้างและออกใบลดหนี้ VAT — บันทึก JP5'
                  : 'ปิดรายการคงค้างของสัญญาตามรายการบัญชี JP5 ด้านบน'
              }
            />
            <Effect text="ตั้งลูกหนี้-หน้าร้าน 11-2107 (ค่าเครื่องคืน) — หักจากยอดโอนในรอบจ่าย INTER-CO ถัดไป หรือรับเงินสดที่หน้าจ่ายให้หน้าร้าน" />
            <Effect text="ขาคู่ SHOP: รับเครื่องเข้าสต็อกมือสอง S11-2002 คู่เจ้าหนี้ FINANCE S21-1104 ที่ราคาประเมิน" />
            <Effect text="บันทึกกำไร/ขาดทุนจากการยึด (41-1102 / 51-1102)" />
            <Effect text="เปลี่ยนสถานะสัญญาเป็น ปิด-หนี้สูญ + สินค้าเป็น ยึดคืน (ย้ายไปสาขาที่รับ)" />
            <Effect text="ใบรับเครื่องคืน → ยืนยันแล้ว + บันทึกการเดินทางลูกค้า 'คืนเครื่อง'" />
            <Effect
              text="จัดการซ่อม/ตั้งราคาขายต่อ ทำต่อที่หน้า รับเครื่องคืน / ยึดคืน & ขายต่อ"
              warning
            />
            <Effect text="ปลดล็อค MDM (PJ-Soft) — ต้องทำ manual" warning />
          </ul>
        </Section>
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 space-y-3">
        {submitBlockReason && (
          <div id="repo-submit-block" role="status" className="text-sm text-warning-strong leading-snug">
            <p>{submitBlockReason}</p>
            {blockedByEligibility && (
              <a href={`/contracts/${contractId}`} className="inline-block mt-1 underline">
                เปิดสัญญาเพื่อตรวจสถานะและยอดค้าง
              </a>
            )}
          </div>
        )}
        <div className="flex items-center justify-between gap-3">
          {canConfirm && deviceReturn && !notPending ? (
            <button
              type="button"
              disabled={mutation.isPending || mutation.isSuccess || drFetching || drFailed}
              onClick={() => !submitting.current && setRejectOpen(true)}
              className="flex items-center gap-1.5 px-4 py-2.5 text-sm border border-destructive/40 text-destructive rounded-lg hover:bg-destructive/10 transition-colors"
            >
              <X className="size-4" />
              ส่งกลับ
            </button>
          ) : (
            <div />
          )}
          <div className="flex gap-3">
            <button
              disabled={mutation.isPending || rejectOpen}
              onClick={() => !submitting.current && !rejectOpen && onClose()}
              className="px-6 py-2.5 text-sm leading-snug border border-input rounded-lg hover:bg-muted transition-colors"
            >
              ยกเลิก
            </button>
            <button
              onClick={() => {
                if (!canSubmit || submitting.current) return;
                submitting.current = true;
                mutation.mutate();
              }}
              disabled={!canSubmit}
              title={submitBlockReason ?? undefined}
              aria-describedby={submitBlockReason ? 'repo-submit-block' : undefined}
              className="px-6 py-2.5 text-sm leading-snug bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm"
            >
              {mutation.isPending ? 'กำลังบันทึก...' : 'ยืนยันรับเครื่องคืน'}
            </button>
          </div>
        </div>
      </div>

      {/* ส่งกลับ — Radix Dialog portal ไป body พร้อม FocusScope ของตัวเอง (ซ้อนบน overlay ได้ตาม scope stack) */}
      <RejectDeviceReturnDialog
        target={rejectOpen && deviceReturn ? deviceReturn : null}
        onClose={() => setRejectOpen(false)}
        onRejected={() => {
          onSuccess();
          onClose();
        }}
      />
    </WizardStackedOverlay>
  );
}
