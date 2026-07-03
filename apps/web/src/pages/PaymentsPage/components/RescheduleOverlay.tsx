import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import Decimal from 'decimal.js';
import {
  CalendarClock,
  CalendarDays,
  Layers,
  Check,
  CheckCircle2,
  AlertTriangle,
  Wallet,
  Banknote,
  Landmark,
  Loader2,
  QrCode,
  Upload,
  X,
} from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { formatThaiDate } from '@/lib/date';
import { CashAccountSelect } from '@/components/CashAccountSelect';
import { WizardStackedOverlay } from '@/components/WizardStackedOverlay';
import { useDebounce } from '@/hooks/useDebounce';
import { useSlipUpload, SLIP_MIME_TYPES } from '@/hooks/useSlipUpload';

interface Props {
  contractId: string;
  contractNumber: string;
  customerName: string;
  branchName?: string;
  /** Payment row id — needed for the reschedule-QR endpoint. */
  paymentId: string;
  installmentNo: number;
  currentDueDate: string;
  /** serialized Decimal — the per-installment total (incl. commission + VAT). */
  monthlyPayment: string;
  defaultDepositAccountCode?: string;
  onClose: () => void;
  onSuccess: () => void;
}

const QUICK_DAYS = [7, 14, 30];

interface RescheduleQuote {
  rescheduleFee: string;
  lateFee: string;
  collectAmount: string;
  variant: '6a' | '6b';
  newDueDate: string;
  currentDueDate: string;
}

interface JePreviewLine {
  accountCode: string;
  accountName: string;
  debit: string;
  credit: string;
  description: string;
}

type CollectMethod = 'CASH' | 'TRANSFER' | 'QR';

/**
 * In-modal "ปรับดิว" (reschedule) overlay — collect-first (owner directive
 * 2026-07-02): เงินไม่เข้า ดิวไม่เลื่อน.
 *
 * Flow: เลือกจำนวนวัน → วิธีเก็บค่าธรรมเนียม (6a/6b) → ชำระเงิน (ค่าธรรมเนียม 6a +
 * ค่าปรับค้าง ถ้ามี) → ยืนยัน. The server quotes fee + late fee authoritatively
 * (GET /payments/reschedule-quote); confirm posts the collect JE + resets the
 * late fee + shifts due dates in ONE transaction. QR is async: the due date
 * shifts only when the PaySolutions webhook confirms payment.
 */
export function RescheduleOverlay({
  contractId,
  contractNumber,
  customerName,
  branchName,
  paymentId,
  installmentNo,
  currentDueDate,
  monthlyPayment,
  defaultDepositAccountCode = '11-1101',
  onClose,
  onSuccess,
}: Props) {
  const queryClient = useQueryClient();
  const [daysToShift, setDaysToShift] = useState(7);
  const [splitMode, setSplitMode] = useState<'SINGLE' | 'SPLIT'>('SINGLE');
  const [method, setMethod] = useState<CollectMethod>('CASH');
  const [depositAccountCode, setDepositAccountCode] = useState(defaultDepositAccountCode);
  const [referenceNumber, setReferenceNumber] = useState('');

  // Slip upload (โอนธนาคาร) — mirrors RecordPaymentWizard: TRANSFER ต้องมี ref + slip
  const [slipUrl, setSlipUrl] = useState('');
  const [slipFileName, setSlipFileName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadMutation = useSlipUpload();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSlipFileName(file.name);
    try {
      const url = await uploadMutation.mutateAsync(file);
      setSlipUrl(url);
      toast.success('อัปโหลดสลิปสำเร็จ');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'อัปโหลดสลิปไม่สำเร็จ');
      setSlipFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleClearSlip = () => {
    setSlipUrl('');
    setSlipFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const days = Math.max(0, Math.floor(daysToShift) || 0);
  const debouncedDays = useDebounce(days, 300);

  // Evidence is amount-specific: changing days/split recomputes collectAmount,
  // so a slip/ref attached for the OLD quote must not survive into the new
  // one's audit trail.
  const isFirstQuote = useRef(true);
  useEffect(() => {
    if (isFirstQuote.current) {
      isFirstQuote.current = false;
      return;
    }
    setReferenceNumber('');
    setSlipUrl('');
    setSlipFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [debouncedDays, splitMode]);

  // Server-authoritative quote — fee (monthly/30×days ปัดขึ้นเต็มบาท) + ค่าปรับค้าง.
  const {
    data: quote,
    isFetching: quoteLoading,
    error: quoteError,
  } = useQuery<RescheduleQuote>({
    queryKey: ['reschedule-quote', contractId, installmentNo, debouncedDays, splitMode],
    queryFn: async () => {
      const { data } = await api.get<RescheduleQuote>('/payments/reschedule-quote', {
        params: { contractId, installmentNo, daysToShift: debouncedDays, splitMode },
      });
      return data;
    },
    enabled: debouncedDays >= 1,
    staleTime: 0,
    retry: false,
  });

  const fee = useMemo(() => new Decimal(quote?.rescheduleFee ?? 0), [quote]);
  const lateFee = useMemo(() => new Decimal(quote?.lateFee ?? 0), [quote]);
  const collect = useMemo(() => new Decimal(quote?.collectAmount ?? 0), [quote]);
  const hasCollect = collect.gt(0);

  // JE preview — the exact lines the confirm will post (collect-first semantics).
  const { data: jePreview } = useQuery<{ lines: JePreviewLine[]; isBalanced: boolean }>({
    queryKey: [
      'reschedule-je-preview',
      contractId,
      installmentNo,
      debouncedDays,
      splitMode,
      depositAccountCode,
      quote?.lateFee,
    ],
    queryFn: async () => {
      const { data } = await api.post('/payments/preview-journal', {
        contractId,
        installmentNo,
        amountReceived: collect.toNumber(),
        depositAccountCode,
        lateFee: lateFee.toNumber(),
        case: 'RESCHEDULE',
        daysToShift: debouncedDays,
        splitMode,
      });
      return data;
    },
    enabled: !!quote && hasCollect && debouncedDays >= 1,
    staleTime: 0,
    retry: false,
  });

  const newDueDate = quote?.newDueDate ?? null;

  // ── Confirm (เงินสด/โอน — synchronous atomic collect + reschedule) ──────────
  const confirmMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/payments/record', {
        contractId,
        installmentNo,
        // Server re-validates against its own quote (±0.01). Zero-collect (6b,
        // no late fee) still needs the DTO's @Min(0.01) — server ignores it then.
        amount: hasCollect ? collect.toNumber() : 0.01,
        paymentMethod: method === 'TRANSFER' ? 'BANK_TRANSFER' : 'CASH',
        case: 'RESCHEDULE',
        daysToShift: days,
        splitMode,
        depositAccountCode,
        ...(referenceNumber ? { transactionRef: referenceNumber } : {}),
        ...(slipUrl ? { slipUrl } : {}),
      });
      return data;
    },
    onSuccess: () => {
      toast.success(
        hasCollect
          ? `ปรับดิวสำเร็จ — เก็บเงิน ${collect.toNumber().toLocaleString('th-TH', { minimumFractionDigits: 2 })} บาท ลงบัญชีแล้ว`
          : 'ปรับดิวสำเร็จ',
      );
      invalidateAll();
      onSuccess();
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  // ── ส่ง QR (async — ดิวเลื่อนเมื่อ webhook ยืนยันเงินเข้า) ─────────────────────
  const qrMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/payments/${paymentId}/reschedule-qr`, {
        daysToShift: days,
        splitMode,
      });
      return data as { sentToLine: boolean; collectAmount: string };
    },
    onSuccess: (data) => {
      toast.success(
        data.sentToLine
          ? 'ส่ง QR ปรับดิวให้ลูกค้าใน LINE แล้ว — ดิวจะเลื่อนอัตโนมัติเมื่อเงินเข้า'
          : 'สร้าง QR แล้ว (ลูกค้าไม่มี LINE — เปิดลิงก์ชำระจากรายการ QR) — ดิวจะเลื่อนเมื่อเงินเข้า',
      );
      invalidateAll();
      onSuccess();
      onClose();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['contract', contractId] });
    queryClient.invalidateQueries({ queryKey: ['contracts'] });
    queryClient.invalidateQueries({ queryKey: ['pending-payments'] });
    queryClient.invalidateQueries({ queryKey: ['pending-summary'] });
    queryClient.invalidateQueries({ queryKey: ['daily-summary'] });
  };

  const isPending = confirmMutation.isPending || qrMutation.isPending;
  const needRef = hasCollect && method === 'TRANSFER' && !referenceNumber.trim();
  const needSlip = hasCollect && method === 'TRANSFER' && !slipUrl;
  const canSubmit = days >= 1 && !isPending && !quoteLoading && !!quote && !needRef && !needSlip;

  const submit = () => {
    if (method === 'QR' && hasCollect) qrMutation.mutate();
    else confirmMutation.mutate();
  };

  return (
    <WizardStackedOverlay maxWidthClass="max-w-xl">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between">
        <button
          onClick={onClose}
          className="flex items-center gap-1.5 text-sm leading-snug text-muted-foreground hover:text-foreground transition-colors"
        >
          ← กลับ
        </button>
        <h2 className="text-lg font-semibold text-foreground leading-snug">
          ปรับดิว — เลื่อนวันครบกำหนด
        </h2>
        <div className="w-16" />
      </div>

      <div className="p-6 space-y-5">
        {/* Section 1: ข้อมูลสัญญา */}
        <Section
          icon={<CalendarClock className="size-4" />}
          title="ข้อมูลสัญญา"
          subtitle="เลขที่, ลูกค้า, งวดปัจจุบัน"
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
            {branchName && (
              <div>
                <span className="text-muted-foreground">สาขา: </span>
                <span className="font-medium">{branchName}</span>
              </div>
            )}
            <div>
              <span className="text-muted-foreground">เลื่อนจากงวดที่: </span>
              <span className="font-medium">{installmentNo}</span>
            </div>
            <div className="col-span-2">
              <span className="text-muted-foreground">ครบกำหนดเดิม: </span>
              <span className="font-medium">{formatThaiDate(currentDueDate)}</span>
            </div>
          </div>
        </Section>

        {/* Section 2: เลื่อนกี่วัน */}
        <Section
          icon={<CalendarDays className="size-4" />}
          title="เลื่อนกี่วัน"
          subtitle="กำหนดจำนวนวันที่ต้องการเลื่อน"
        >
          <label className="block text-xs font-medium text-foreground mb-1.5 leading-snug">
            จำนวนวันที่เลื่อน
          </label>
          <div className="flex flex-wrap gap-2 mb-3">
            {QUICK_DAYS.map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDaysToShift(d)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  days === d
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-background border-input hover:bg-muted'
                }`}
              >
                {d} วัน
              </button>
            ))}
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={365}
                value={daysToShift}
                onChange={(e) =>
                  setDaysToShift(Math.max(1, Math.min(365, Number(e.target.value) || 0)))
                }
                className="w-20 px-2 py-1.5 border border-input rounded-lg text-sm text-right font-mono"
                aria-label="จำนวนวันที่เลื่อน"
              />
              <span className="text-sm text-muted-foreground">วัน</span>
            </div>
          </div>
          <div className="space-y-1.5 text-sm">
            {newDueDate && (
              <Row label="ครบกำหนดใหม่ (งวดนี้)" value={formatThaiDate(newDueDate)} bold />
            )}
            <Row
              label="ค่าธรรมเนียมเลื่อนดิว"
              value={quoteLoading ? 'กำลังคำนวณ…' : `${fee.toFixed(2)} บาท`}
            />
            <p className="text-xs text-muted-foreground leading-snug">
              คำนวณจาก ค่างวด ({new Decimal(monthlyPayment || 0).toFixed(2)}) ÷ 30 × {days} วัน
              (ปัดขึ้นเต็มบาท)
            </p>
          </div>
        </Section>

        {/* Section 3: รูปแบบค่าธรรมเนียม (6a/6b) */}
        <Section
          icon={<Layers className="size-4" />}
          title="วิธีเก็บค่าธรรมเนียม"
          subtitle="เลือกรูปแบบการเก็บค่าธรรมเนียมเลื่อนดิว"
        >
          <div className="space-y-2">
            <ModeOption
              active={splitMode === 'SINGLE'}
              onClick={() => setSplitMode('SINGLE')}
              title="รวมกับงวดถัดไป (6b)"
              desc="ค่าธรรมเนียมรวมไปกับค่างวดถัดไป — วันนี้เก็บเฉพาะค่าปรับ (ถ้ามี)"
            />
            <ModeOption
              active={splitMode === 'SPLIT'}
              onClick={() => setSplitMode('SPLIT')}
              title="เก็บค่าธรรมเนียมตอนนี้ (6a)"
              desc="เก็บค่าธรรมเนียมเลื่อนดิว + ค่าปรับ (ถ้ามี) เป็นเงินสด/โอน/QR ก่อนเลื่อนดิว"
            />
          </div>
        </Section>

        {/* Section 4: ชำระเงิน (collect-first — เงินไม่เข้า ดิวไม่เลื่อน) */}
        <Section
          icon={<Wallet className="size-4" />}
          title="ชำระเงิน"
          subtitle="ยอดที่ต้องเก็บก่อนเลื่อนดิว"
        >
          {quoteError ? (
            <p className="text-sm text-destructive leading-snug">{getErrorMessage(quoteError)}</p>
          ) : (
            <>
              <div className="space-y-1.5 text-sm mb-3">
                {splitMode === 'SPLIT' && (
                  <Row label="ค่าธรรมเนียมเลื่อนดิว (6a)" value={`${fee.toFixed(2)} บาท`} />
                )}
                <Row
                  label="ค่าปรับค้างชำระ"
                  value={lateFee.gt(0) ? `${lateFee.toFixed(2)} บาท` : 'ไม่มี'}
                />
                <div className="border-t border-border pt-1.5">
                  <Row label="รวมต้องเก็บวันนี้" value={`${collect.toFixed(2)} บาท`} bold />
                </div>
              </div>

              {hasCollect ? (
                <>
                  {/* ช่องทางรับชำระ */}
                  <div className="grid grid-cols-3 gap-2 mb-3">
                    <MethodButton
                      active={method === 'CASH'}
                      onClick={() => setMethod('CASH')}
                      icon={<Banknote className="size-4" />}
                      label="เงินสด"
                    />
                    <MethodButton
                      active={method === 'TRANSFER'}
                      onClick={() => setMethod('TRANSFER')}
                      icon={<Landmark className="size-4" />}
                      label="โอนธนาคาร"
                    />
                    <MethodButton
                      active={method === 'QR'}
                      onClick={() => setMethod('QR')}
                      icon={<QrCode className="size-4" />}
                      label="QR ใน LINE"
                    />
                  </div>

                  {method !== 'QR' && (
                    <div className="space-y-2.5">
                      <div>
                        <label className="block text-xs font-medium text-foreground mb-1 leading-snug">
                          บัญชีรับเงิน
                        </label>
                        <CashAccountSelect
                          value={depositAccountCode}
                          onChange={setDepositAccountCode}
                        />
                      </div>
                      {method === 'TRANSFER' && (
                        <>
                          <div>
                            <label className="block text-xs font-medium text-foreground mb-1 leading-snug">
                              เลขอ้างอิงการโอน <span className="text-destructive">*</span>
                            </label>
                            <input
                              type="text"
                              value={referenceNumber}
                              onChange={(e) => setReferenceNumber(e.target.value)}
                              placeholder="เลขอ้างอิงจากสลิปโอนเงิน"
                              className="w-full px-3 py-2 border border-input rounded-lg text-sm"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-foreground mb-1 leading-snug">
                              แนบสลิปโอนเงิน <span className="text-destructive">*</span>
                            </label>
                            <input
                              ref={fileInputRef}
                              type="file"
                              accept={SLIP_MIME_TYPES.join(',')}
                              className="hidden"
                              aria-label="อัปโหลดสลิป"
                              onChange={handleFileChange}
                            />
                            {slipUrl ? (
                              <div className="flex items-center gap-2 rounded-lg border border-success/40 bg-success/5 px-3 py-2.5">
                                <CheckCircle2 className="size-4 text-success shrink-0" />
                                <span className="text-sm text-foreground leading-snug truncate flex-1">
                                  {slipFileName || 'สลิปอัปโหลดแล้ว'}
                                </span>
                                <button
                                  type="button"
                                  onClick={handleClearSlip}
                                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                                  aria-label="ลบสลิป"
                                >
                                  <X className="size-3.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => fileInputRef.current?.click()}
                                disabled={uploadMutation.isPending}
                                className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-4 py-3 text-sm text-muted-foreground hover:border-primary/40 hover:text-foreground hover:bg-accent transition-colors disabled:opacity-60 disabled:pointer-events-none"
                              >
                                {uploadMutation.isPending ? (
                                  <>
                                    <Loader2 className="size-4 animate-spin" />
                                    <span className="leading-snug">กำลังอัปโหลด...</span>
                                  </>
                                ) : (
                                  <>
                                    <Upload className="size-4" />
                                    <span className="leading-snug">
                                      คลิกเพื่ออัปโหลดสลิป (JPG/PNG/PDF)
                                    </span>
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {method === 'QR' && (
                    <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2.5 text-xs text-warning leading-snug">
                      ระบบจะส่ง QR ยอด {collect.toFixed(2)} บาท ให้ลูกค้าใน LINE —
                      <strong> ดิวจะเลื่อนอัตโนมัติเมื่อเงินเข้าเท่านั้น</strong> (QR หมดอายุใน 24
                      ชม. ถ้าลูกค้าไม่จ่าย ดิวไม่เลื่อน)
                    </div>
                  )}

                  {/* JE preview — บรรทัดบัญชีที่จะลงจริงตอนยืนยัน */}
                  {method !== 'QR' && jePreview && jePreview.lines.length > 0 && (
                    <div className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                      <div className="text-xs font-semibold text-muted-foreground mb-1.5 leading-snug">
                        รายการบัญชี (ลงทันทีตอนยืนยัน)
                      </div>
                      <div className="space-y-1">
                        {jePreview.lines.map((l, i) => (
                          <div
                            key={i}
                            className="flex justify-between text-xs font-mono leading-snug"
                          >
                            <span className="text-muted-foreground">
                              {l.accountCode} {l.accountName}
                            </span>
                            <span>{Number(l.debit) > 0 ? `Dr ${l.debit}` : `Cr ${l.credit}`}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-lg border border-success/40 bg-success/10 px-3 py-2.5 text-xs text-success leading-snug">
                  ไม่มียอดต้องเก็บวันนี้ (6b + ไม่มีค่าปรับ) — ยืนยันปรับดิวได้เลย
                </div>
              )}
            </>
          )}
        </Section>

        {/* Section 5: สิ่งที่จะเกิดขึ้น */}
        <Section
          icon={<Check className="size-4" />}
          title="สิ่งที่จะเกิดขึ้นเมื่อยืนยัน"
          subtitle="ตรวจสอบก่อนปรับดิว"
          tone="success"
        >
          <ul className="space-y-1.5 text-sm">
            {hasCollect && method === 'QR' ? (
              <Effect
                text={`ส่ง QR ยอด ${collect.toFixed(2)} บาท ให้ลูกค้า — ดิวเลื่อนเมื่อเงินเข้า`}
                warning
              />
            ) : (
              <>
                {hasCollect && (
                  <Effect
                    text={`เก็บเงิน ${collect.toFixed(2)} บาท${lateFee.gt(0) ? ` (รวมค่าปรับ ${lateFee.toFixed(2)} บาท → ลงบัญชี 42-1103)` : ''} + ลงบัญชีทันที`}
                  />
                )}
                {lateFee.gt(0) && (
                  <Effect text="ค่าปรับช่วงที่เกินมาแล้วถูกเก็บและปิดยอด — เริ่มนับใหม่จากดิวใหม่" />
                )}
              </>
            )}
            <Effect text={`เลื่อนวันครบกำหนดงวดที่ ${installmentNo} เป็นต้นไป +${days} วัน`} />
            {splitMode === 'SPLIT' && fee.gt(0) && (
              <Effect
                text={`ค่าธรรมเนียม ${fee.toFixed(2)} บาท บันทึกเป็นเงินรับล่วงหน้า (นำไปหักค่างวดถัดไปอัตโนมัติ)`}
              />
            )}
            {splitMode === 'SINGLE' && fee.gt(0) && (
              <Effect
                text={`ค่าธรรมเนียม ${fee.toFixed(2)} บาท จดไว้ในโน้ตงวดนี้ — เก็บเพิ่มพร้อมค่างวดตอนรับชำระ`}
                warning
              />
            )}
            <Effect
              text={`บันทึก AuditLog (RESCHEDULE ${splitMode === 'SPLIT' ? '6a' : '6b'} + RESCHEDULE_COLLECT)`}
            />
          </ul>
        </Section>
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 flex items-center justify-end gap-3">
        <button
          onClick={onClose}
          className="px-6 py-2.5 text-sm leading-snug border border-input rounded-lg hover:bg-muted transition-colors"
        >
          ยกเลิก
        </button>
        <button
          onClick={submit}
          disabled={!canSubmit}
          className="px-6 py-2.5 text-sm leading-snug bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm"
        >
          {isPending
            ? 'กำลังดำเนินการ...'
            : method === 'QR' && hasCollect
              ? 'ส่ง QR ให้ลูกค้า'
              : hasCollect
                ? `เก็บเงิน ${collect.toFixed(2)} + ยืนยันปรับดิว`
                : 'ยืนยันปรับดิว'}
        </button>
      </div>
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
  tone?: 'primary' | 'success';
  children: React.ReactNode;
}) {
  const iconClass =
    tone === 'success' ? 'bg-success/10 text-success' : 'bg-primary/10 text-primary';
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

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between items-baseline">
      <span className="text-muted-foreground leading-snug">{label}</span>
      <span
        className={`leading-snug ${bold ? 'font-semibold text-foreground' : 'text-foreground'}`}
      >
        {value}
      </span>
    </div>
  );
}

function ModeOption({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  desc: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`w-full text-left rounded-xl border-2 px-3 py-2.5 transition-colors ${
        active
          ? 'bg-primary/5 border-primary'
          : 'bg-card border-border hover:border-primary/40 hover:bg-accent'
      }`}
    >
      <div className="text-sm font-semibold text-foreground leading-snug">{title}</div>
      <div className="text-xs text-muted-foreground leading-snug">{desc}</div>
    </button>
  );
}

function MethodButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`flex items-center justify-center gap-1.5 rounded-xl border-2 px-2 py-2 text-sm font-medium leading-snug transition-colors ${
        active
          ? 'bg-primary border-primary text-primary-foreground'
          : 'bg-card border-border text-foreground hover:border-primary/40 hover:bg-accent'
      }`}
    >
      {icon}
      {label}
    </button>
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
