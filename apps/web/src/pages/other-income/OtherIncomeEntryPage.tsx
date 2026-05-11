import { useMemo, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Save,
  Send,
  ArrowLeft,
  FileText,
  AlertTriangle,
  CloudUpload,
  CheckCircle2,
  Upload,
  Wallet,
  Building2,
  Zap,
  Lightbulb,
  XCircle,
} from 'lucide-react';
import Decimal from 'decimal.js';
import QueryBoundary from '@/components/QueryBoundary';
import { AccountingModuleTabBar } from '@/components/accounting/AccountingModuleTabBar';
import { useAuth } from '@/contexts/AuthContext';
import { formatNumber, formatNumberDecimal } from '@/utils/formatters';
import { otherIncomeApi } from '@/lib/otherIncome';
import { otherIncomeFormSchema, type OtherIncomeFormValues } from '@/lib/otherIncome.schema';
import { ItemsTable } from './components/ItemsTable';
import { AdjustmentTable } from './components/AdjustmentTable';
import { AutoJournalPreview } from './components/AutoJournalPreview';
import { CounterpartyPicker } from './components/CounterpartyPicker';

// Fallback while config is loading; live value comes from /other-income/config/attachment-threshold
const ATTACHMENT_THRESHOLD_FALLBACK = 50_000;

// ------------------------------------------------------------------
// JE preview computation — mirrors AutoJournalService on the backend
// ------------------------------------------------------------------
interface JeLine {
  accountCode: string;
  debit: number;
  credit: number;
  description?: string;
}

// All money math uses Decimal to mirror the backend AutoJournalService — JS float
// would let the preview show "BALANCED" while the server returns "UNBALANCED" for
// edge cases like 0.10 + 0.20 = 0.30000000000000004.
const D = (v: number | string | null | undefined) => new Decimal(v ?? 0);
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

function computeJePreview(values: OtherIncomeFormValues): JeLine[] {
  const lines: JeLine[] = [];
  if (!values.items || values.items.length === 0) return lines;

  let totalAmountBeforeVat = new Decimal(0);
  let totalVat = new Decimal(0);
  let totalWht = new Decimal(0);

  for (const item of values.items) {
    const qty = D(item.quantity);
    const unit = D(item.unitAmount);
    const disc = D(item.discountAmount);
    const vatPct = D(item.vatPct);
    const whtPct = D(item.whtPct);
    const gross = qty.mul(unit).minus(disc);

    let amountBeforeVat: Decimal;
    let vatAmount: Decimal;
    if (vatPct.gt(0)) {
      if (values.priceType === 'INCLUSIVE') {
        amountBeforeVat = r2(gross.div(new Decimal(1).plus(vatPct.div(100))));
        vatAmount = r2(gross.minus(amountBeforeVat));
      } else {
        amountBeforeVat = gross;
        vatAmount = r2(gross.mul(vatPct).div(100));
      }
    } else {
      amountBeforeVat = gross;
      vatAmount = new Decimal(0);
    }
    const whtAmount = r2(amountBeforeVat.mul(whtPct).div(100));

    totalAmountBeforeVat = totalAmountBeforeVat.plus(amountBeforeVat);
    totalVat = totalVat.plus(vatAmount);
    totalWht = totalWht.plus(whtAmount);

    // Cr revenue account (42-XXXX)
    if (amountBeforeVat.gt(0)) {
      lines.push({
        accountCode: item.accountCode || '42-XXXX',
        debit: 0,
        credit: r2(amountBeforeVat).toNumber(),
        description: item.description || undefined,
      });
    }
  }

  // Cr VAT output (21-2101) if any
  if (totalVat.gt(0)) {
    lines.push({
      accountCode: '21-2101',
      debit: 0,
      credit: r2(totalVat).toNumber(),
      description: 'ภาษีขาย',
    });
  }

  // Dr WHT receivable (11-4103) if any
  if (totalWht.gt(0)) {
    lines.push({
      accountCode: '11-4103',
      debit: r2(totalWht).toNumber(),
      credit: 0,
      description: 'ภาษีหัก ณ ที่จ่าย (รอเรียกคืน)',
    });
  }

  // Adjustments (Dr/Cr depending on over/under)
  const amountReceived = D(values.amountReceived);
  const netExpected = r2(totalAmountBeforeVat.plus(totalVat).minus(totalWht));
  const diff = r2(amountReceived.minus(netExpected));

  if (values.adjustments && values.adjustments.length > 0) {
    for (const adj of values.adjustments) {
      const amt = D(adj.amount);
      if (amt.gt(0) && adj.accountCode) {
        const amtN = r2(amt).toNumber();
        if (diff.gt(0)) {
          // received more → Cr adjustment account
          lines.push({ accountCode: adj.accountCode, debit: 0, credit: amtN, description: adj.note || undefined });
        } else {
          // received less → Dr adjustment account (expense/discount)
          lines.push({ accountCode: adj.accountCode, debit: amtN, credit: 0, description: adj.note || undefined });
        }
      }
    }
  }

  // Dr cash/bank received
  if (amountReceived.gt(0)) {
    lines.push({
      accountCode: values.paymentAccountCode || '11-1201',
      debit: r2(amountReceived).toNumber(),
      credit: 0,
      description: 'รับเงิน',
    });
  }

  return lines;
}

// ------------------------------------------------------------------

// "Today" in Asia/Bangkok — guards against UTC server returning yesterday
// between 00:00–07:00 BKK time when an accounting doc is created.
function todayBangkok(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Bangkok' });
}

const defaultValues: OtherIncomeFormValues = {
  issueDate: todayBangkok(),
  dueDate: '',
  paymentDate: '',
  priceType: 'EXCLUSIVE',
  customerId: '',
  counterpartyName: '',
  counterpartyTaxId: '',
  counterpartyAddress: '',
  counterpartyPhone: '',
  paymentAccountCode: '11-1201',
  amountReceived: 0,
  items: [
    {
      accountCode: '42-1102',
      quantity: 1,
      unitAmount: 0,
      discountAmount: 0,
      vatPct: 0,
      whtPct: 15,
      description: '',
    },
  ],
  adjustments: [],
  customerNote: '',
};

// Cash/bank account options
const PAYMENT_ACCOUNTS = [
  { code: '11-1101', name: 'สุทธินีย์', kind: 'cash' as const },
  { code: '11-1102', name: 'เอกนรินทร์', kind: 'cash' as const },
  { code: '11-1103', name: 'พนักงานบัญชี', kind: 'cash' as const },
  { code: '11-1201', name: 'กสิกรไทย', kind: 'bank' as const },
  { code: '11-1202', name: 'SCB ค่าใช้จ่าย', kind: 'bank' as const },
  { code: '11-1203', name: 'SCB ค่าเสื่อม', kind: 'bank' as const },
];

const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];

function fmt(n: number) {
  return formatNumberDecimal(n, 2);
}

function SectionHeader({
  num,
  title,
  hint,
  action,
}: {
  num: number;
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2 min-w-0">
        <span className="size-6 rounded bg-primary/15 text-primary text-xs font-bold flex items-center justify-center shrink-0">
          {num}
        </span>
        <h2 className="text-sm font-bold text-foreground leading-snug">{title}</h2>
        {hint && (
          <span className="text-xs text-muted-foreground font-normal hidden md:inline">
            {hint}
          </span>
        )}
      </div>
      {action}
    </div>
  );
}

export default function OtherIncomeEntryPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const queryClient = useQueryClient();
  const isEdit = !!id;

  // Load existing doc when editing a draft
  const loadQuery = useQuery({
    queryKey: ['other-income', id],
    queryFn: () => otherIncomeApi.findOne(id!),
    enabled: isEdit,
  });

  const form = useForm<OtherIncomeFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: standardSchemaResolver(otherIncomeFormSchema) as any,
    defaultValues: { ...defaultValues, issueDate: todayBangkok() },
    mode: 'onChange',
  });

  const { user } = useAuth();

  // Populate form when existing doc loads (edit mode)
  const { reset } = form;
  useEffect(() => {
    if (loadQuery.data && isEdit) {
      const d = loadQuery.data;
      reset({
        issueDate: d.issueDate ? d.issueDate.slice(0, 10) : defaultValues.issueDate,
        dueDate: d.dueDate ? d.dueDate.slice(0, 10) : '',
        paymentDate: d.paymentDate ? d.paymentDate.slice(0, 10) : '',
        priceType: d.priceType,
        customerId: d.customerId ?? '',
        counterpartyName: d.counterpartyName ?? '',
        counterpartyTaxId: d.counterpartyTaxId ?? '',
        counterpartyAddress: d.counterpartyAddress ?? '',
        counterpartyPhone: d.counterpartyPhone ?? '',
        paymentAccountCode: d.paymentAccountCode,
        amountReceived: parseFloat(d.amountReceived) || 0,
        items: d.items.map((item) => ({
          accountCode: item.accountCode,
          quantity: parseFloat(item.quantity),
          unitAmount: parseFloat(item.unitAmount),
          discountAmount: parseFloat(item.discountAmount) || 0,
          vatPct: parseFloat(item.vatPct) || 0,
          whtPct: parseFloat(item.whtPct) || 0,
          description: item.description ?? '',
        })),
        adjustments: d.adjustments.map((adj) => ({
          accountCode: adj.accountCode,
          amount: parseFloat(adj.amount),
          note: adj.note ?? '',
        })),
        customerNote: d.customerNote ?? '',
      });
    }
  }, [loadQuery.data, isEdit, reset]);

  const saveDraftMutation = useMutation({
    mutationFn: (data: OtherIncomeFormValues) =>
      isEdit ? otherIncomeApi.update(id!, data) : otherIncomeApi.create(data),
    onSuccess: (doc) => {
      toast.success('บันทึกร่างแล้ว');
      queryClient.invalidateQueries({ queryKey: ['other-income'] });
      if (!isEdit) navigate(`/other-income/${doc.id}/edit`);
    },
    onError: () => toast.error('ไม่สามารถบันทึกได้'),
  });

  const saveAndPostMutation = useMutation({
    mutationFn: async (data: OtherIncomeFormValues) => {
      let docId = id;
      if (!docId) {
        const created = await otherIncomeApi.create(data);
        docId = created.id;
      } else {
        await otherIncomeApi.update(docId, data);
      }
      return otherIncomeApi.post(docId);
    },
    onSuccess: (doc) => {
      toast.success('บันทึกและ POST เอกสารแล้ว');
      queryClient.invalidateQueries({ queryKey: ['other-income'] });
      navigate(`/other-income/${doc.id}`);
    },
    onError: () => toast.error('ไม่สามารถ POST เอกสารได้'),
  });

  const values = form.watch();

  // Compute live JE preview
  const jeLines = useMemo(() => computeJePreview(values), [values]);

  // Compute net expected vs received for AdjustmentTable
  const { totalDiff, diffSign } = useMemo(() => {
    let totalAmountBeforeVat = 0;
    let totalVat = 0;
    let totalWht = 0;
    for (const item of values.items ?? []) {
      const qty = Number(item.quantity) || 0;
      const unit = Number(item.unitAmount) || 0;
      const disc = Number(item.discountAmount) || 0;
      const vatPct = Number(item.vatPct) || 0;
      const whtPct = Number(item.whtPct) || 0;
      const gross = qty * unit - disc;
      let amountBeforeVat: number;
      let vatAmount: number;
      if (vatPct > 0) {
        if (values.priceType === 'INCLUSIVE') {
          amountBeforeVat = +(gross / (1 + vatPct / 100)).toFixed(2);
          vatAmount = +(gross - amountBeforeVat).toFixed(2);
        } else {
          amountBeforeVat = gross;
          vatAmount = +((gross * vatPct) / 100).toFixed(2);
        }
      } else {
        amountBeforeVat = gross;
        vatAmount = 0;
      }
      const whtAmount = +((amountBeforeVat * whtPct) / 100).toFixed(2);
      totalAmountBeforeVat += amountBeforeVat;
      totalVat += vatAmount;
      totalWht += whtAmount;
    }
    const net = +(totalAmountBeforeVat + totalVat - totalWht).toFixed(2);
    const amtRcv = Number(values.amountReceived) || 0;
    const diff = +(amtRcv - net).toFixed(2);
    let sign: 'over' | 'under' | 'zero';
    if (Math.abs(diff) < 0.01) sign = 'zero';
    else if (diff > 0) sign = 'over';
    else sign = 'under';
    return { totalDiff: +Math.abs(diff).toFixed(2), diffSign: sign };
  }, [values]);

  const watchedAdjustments = form.watch('adjustments') ?? [];

  const isSubmitting = saveDraftMutation.isPending || saveAndPostMutation.isPending;

  // Income totals across all items (for footer/summary cards)
  const incomeTotals = useMemo(() => {
    let beforeVat = 0;
    let vat = 0;
    let wht = 0;
    for (const item of values.items ?? []) {
      const qty = Number(item.quantity) || 0;
      const unit = Number(item.unitAmount) || 0;
      const disc = Number(item.discountAmount) || 0;
      const vatPct = Number(item.vatPct) || 0;
      const whtPct = Number(item.whtPct) || 0;
      const gross = qty * unit - disc;
      let bv: number;
      let v: number;
      if (vatPct > 0) {
        if (values.priceType === 'INCLUSIVE') {
          bv = +(gross / (1 + vatPct / 100)).toFixed(2);
          v = +(gross - bv).toFixed(2);
        } else {
          bv = gross;
          v = +((gross * vatPct) / 100).toFixed(2);
        }
      } else {
        bv = gross;
        v = 0;
      }
      const w = +((bv * whtPct) / 100).toFixed(2);
      beforeVat += bv;
      vat += v;
      wht += w;
    }
    return {
      beforeVat: +beforeVat.toFixed(2),
      vat: +vat.toFixed(2),
      wht: +wht.toFixed(2),
      total: +(beforeVat + vat).toFixed(2),
      net: +(beforeVat + vat - wht).toFixed(2),
    };
  }, [values]);

  // Live validation messages (Section 5 red box)
  const validationMessages = useMemo(() => {
    const msgs: string[] = [];
    if (!values.customerId && !(values.counterpartyName ?? '').trim()) {
      msgs.push('กรุณาเลือกลูกค้า');
    }
    if (!values.items || values.items.length === 0) {
      msgs.push('รายการ #1: ใส่จำนวนเงิน');
    } else {
      values.items.forEach((item, idx) => {
        const qty = Number(item.quantity) || 0;
        const unit = Number(item.unitAmount) || 0;
        if (qty <= 0 || unit <= 0) {
          msgs.push(`รายการ #${idx + 1}: ใส่จำนวนเงิน`);
        }
        if (!item.accountCode) {
          msgs.push(`รายการ #${idx + 1}: เลือกบัญชี`);
        }
      });
    }
    if (!values.paymentAccountCode) {
      msgs.push('กรุณาเลือกช่องทางการชำระ');
    }
    if (!values.amountReceived || Number(values.amountReceived) <= 0) {
      msgs.push('กรุณาระบุจำนวนเงินที่ได้รับจริง');
    }
    return msgs;
  }, [values]);

  // B7: Attachment uploader (only available after doc is saved and has an id)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const uploadAttachmentMutation = useMutation({
    mutationFn: (file: File) => otherIncomeApi.uploadAttachment(id!, file),
    onSuccess: () => {
      toast.success('แนบไฟล์เรียบร้อยแล้ว');
      queryClient.invalidateQueries({ queryKey: ['other-income', id] });
    },
    onError: () => toast.error('ไม่สามารถแนบไฟล์ได้'),
  });

  function handleFileSelect(file: File) {
    if (!ALLOWED_MIME.includes(file.type)) {
      toast.error('รองรับเฉพาะ PDF / JPG / PNG / WebP');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('ไฟล์มีขนาดเกิน 5 MB');
      return;
    }
    uploadAttachmentMutation.mutate(file);
  }

  const thresholdQuery = useQuery({
    queryKey: ['other-income-attachment-threshold'],
    queryFn: () => otherIncomeApi.getAttachmentThreshold(),
    staleTime: 5 * 60_000,
  });
  const attachmentThreshold = thresholdQuery.data ?? ATTACHMENT_THRESHOLD_FALLBACK;

  const currentAttachments = loadQuery.data?.attachments ?? [];
  const amountReceived = Number(values.amountReceived) || 0;
  const needsAttachment = amountReceived >= attachmentThreshold && currentAttachments.length === 0;

  const docNumber = loadQuery.data?.docNumber;
  const docStatus = loadQuery.data?.status ?? 'DRAFT';
  const errorCount = validationMessages.length;
  const canPost = errorCount === 0 && !needsAttachment;
  const userDisplayName = user?.name || user?.email || 'ผู้ใช้ปัจจุบัน';

  return (
    <div className="pb-32">
      <div className="p-4 md:p-6 max-w-5xl mx-auto">
        <div className="mb-4">
          <AccountingModuleTabBar />
        </div>
        {/* Custom header */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div className="min-w-0">
            <button
              type="button"
              onClick={() => navigate('/other-income')}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-2"
            >
              <ArrowLeft size={14} /> กลับไปหน้ารายการ
            </button>
            <h1 className="text-xl md:text-2xl font-bold text-foreground leading-tight">
              {isEdit ? 'แก้ไขเอกสารรายได้อื่น' : 'บันทึกรายได้อื่น'}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              กลุ่มบัญชี 42-XXXX · Auto Journal · Validation V1-V10
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs text-muted-foreground">เลขที่เอกสาร</p>
            <p className="font-mono text-sm font-semibold text-foreground">
              {docNumber ?? '— จะออกหลังบันทึก —'}
            </p>
            <span
              className={`mt-1 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold tracking-wider ${
                docStatus === 'POSTED'
                  ? 'bg-success/10 text-success'
                  : docStatus === 'REVERSED'
                    ? 'bg-destructive/10 text-destructive'
                    : 'bg-warning/15 text-warning'
              }`}
            >
              {docStatus}
            </span>
          </div>
        </div>

        {isEdit && (
          <QueryBoundary
            isLoading={loadQuery.isLoading}
            isError={loadQuery.isError}
            error={loadQuery.error}
            onRetry={loadQuery.refetch}
          >
            <></>
          </QueryBoundary>
        )}

        <form onSubmit={(e) => e.preventDefault()} className="space-y-6">
          {/* Section 1 — Customer & document */}
          <section className="rounded-xl border bg-card p-5">
            <SectionHeader num={1} title="ข้อมูลลูกค้า & เอกสาร" />
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  ลูกค้า <span className="text-destructive">*</span>
                </label>
                <div className="mt-1">
                  <CounterpartyPicker
                    value={{
                      customerId: values.customerId ?? null,
                      name: values.counterpartyName ?? '',
                      taxId: values.counterpartyTaxId,
                      address: values.counterpartyAddress,
                      phone: values.counterpartyPhone,
                    }}
                    onChange={(cp) => {
                      form.setValue('customerId', cp.customerId ?? '', {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                      form.setValue('counterpartyName', cp.name, {
                        shouldDirty: true,
                        shouldValidate: true,
                      });
                      form.setValue('counterpartyTaxId', cp.taxId ?? '', { shouldDirty: true });
                      form.setValue('counterpartyAddress', cp.address ?? '', { shouldDirty: true });
                      form.setValue('counterpartyPhone', cp.phone ?? '', { shouldDirty: true });
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    วันที่ออกเอกสาร <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="date"
                    {...form.register('issueDate')}
                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-background"
                  />
                  {form.formState.errors.issueDate && (
                    <p className="text-xs text-destructive mt-1">
                      {form.formState.errors.issueDate.message}
                    </p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">
                    วันที่ครบกำหนด
                  </label>
                  <input
                    type="date"
                    {...form.register('dueDate')}
                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-background"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">ประเภท VAT</label>
                  <select
                    {...form.register('priceType')}
                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-background"
                  >
                    <option value="EXCLUSIVE">แยกภาษี</option>
                    <option value="INCLUSIVE">รวมภาษี</option>
                  </select>
                </div>
              </div>
            </div>
          </section>

          {/* Section 2 — Accounting items */}
          <section className="rounded-xl border bg-card p-5">
            <SectionHeader num={2} title="รายการบันทึกทางบัญชี" />
            {form.formState.errors.items && typeof form.formState.errors.items.message === 'string' && (
              <p className="text-xs text-destructive mb-2">{form.formState.errors.items.message}</p>
            )}
            <ItemsTable
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              control={form.control as any}
              register={form.register}
              watch={form.watch}
              setValue={form.setValue}
            />
            <div className="mt-4 flex items-center justify-between border-t pt-3 text-xs">
              <div className="inline-flex items-center gap-2 text-muted-foreground">
                <FileText size={14} />
                <span>
                  ก่อนภาษี:{' '}
                  <span className="font-mono font-semibold text-foreground">
                    {fmt(incomeTotals.beforeVat)}
                  </span>
                </span>
              </div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-primary/10 text-primary font-semibold">
                <span>ยอดรวม:</span>
                <span className="font-mono">{fmt(incomeTotals.total)} ฿</span>
              </div>
            </div>
          </section>

          {/* Section 3 — Payment channel */}
          <section className="rounded-xl border bg-card p-5">
            <SectionHeader num={3} title="ช่องทางการชำระเงิน" />
            <div className="space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground">
                  เลือกบัญชีรับเงิน <span className="text-destructive">*</span>
                </label>
                <div
                  className="mt-2 grid grid-cols-2 md:grid-cols-3 gap-2"
                  role="radiogroup"
                  aria-label="เลือกบัญชีรับเงิน"
                >
                  {PAYMENT_ACCOUNTS.map((a) => {
                    const selected = values.paymentAccountCode === a.code;
                    const Icon = a.kind === 'cash' ? Wallet : Building2;
                    return (
                      <button
                        key={a.code}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        aria-label={`${a.name} (${a.code})`}
                        onClick={() =>
                          form.setValue('paymentAccountCode', a.code, {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                        }
                        className={`flex items-center gap-2 p-3 rounded-lg border-2 text-left transition-colors ${
                          selected
                            ? 'border-primary bg-primary/5'
                            : 'border-border hover:border-primary/40 hover:bg-accent/40'
                        }`}
                      >
                        <div
                          className={`size-8 rounded-md flex items-center justify-center shrink-0 ${
                            selected ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                          }`}
                        >
                          <Icon size={16} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-foreground leading-tight truncate">
                            {a.name}
                          </p>
                          <p className="text-[10px] font-mono text-muted-foreground">{a.code}</p>
                        </div>
                      </button>
                    );
                  })}
                </div>
                {form.formState.errors.paymentAccountCode && (
                  <p className="text-xs text-destructive mt-1">
                    {form.formState.errors.paymentAccountCode.message}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">วันที่ชำระ</label>
                  <input
                    type="date"
                    {...form.register('paymentDate')}
                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-background"
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-medium text-muted-foreground">
                      จำนวนเงินที่ได้รับจริง <span className="text-destructive">*</span>
                    </label>
                    {incomeTotals.net > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          form.setValue('amountReceived', incomeTotals.net, {
                            shouldDirty: true,
                            shouldValidate: true,
                          })
                        }
                        className="inline-flex items-center gap-1 text-xs text-primary font-semibold hover:underline"
                      >
                        <Zap size={11} />
                        ใช้ยอดสุทธิ ({fmt(incomeTotals.net)})
                      </button>
                    )}
                  </div>
                  <div className="mt-1 relative">
                    <input
                      type="number"
                      step="0.01"
                      {...form.register('amountReceived')}
                      placeholder="0.00"
                      className="w-full border rounded-md px-3 py-2 text-sm font-mono text-right bg-background pr-8"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                      ฿
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-1 text-right">
                    ยอดที่ลูกค้าจ่ายมาจริง
                  </p>
                  {form.formState.errors.amountReceived && (
                    <p className="text-xs text-destructive mt-1">
                      {form.formState.errors.amountReceived.message}
                    </p>
                  )}
                </div>
              </div>

              {(Number(values.amountReceived) || 0) === 0 && (
                <div className="flex items-start gap-2 p-3 rounded-md bg-muted/40 text-xs text-muted-foreground">
                  <Lightbulb size={14} className="text-warning shrink-0 mt-0.5" />
                  <span>กรอก "จำนวนเงินที่ได้รับจริง" เพื่อตรวจเปรียบเทียบกับยอดสุทธิ</span>
                </div>
              )}

              {diffSign !== 'zero' && (
                <AdjustmentTable
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  control={form.control as any}
                  register={form.register}
                  setValue={form.setValue}
                  totalDiff={totalDiff}
                  diffSign={diffSign}
                  watchedAdjustments={watchedAdjustments}
                />
              )}
            </div>
          </section>

          {/* Section 4 — Note */}
          <section className="rounded-xl border bg-card p-5">
            <SectionHeader num={4} title="หมายเหตุสำหรับลูกค้า" />
            <textarea
              {...form.register('customerNote')}
              rows={3}
              placeholder="ข้อความที่จะแสดงในใบเสร็จ (ไม่บังคับ)"
              className="w-full border rounded-md px-3 py-2 text-sm bg-background"
            />
          </section>

          {/* Section 5 — Validation errors (POST-time only; draft can still save) */}
          {validationMessages.length > 0 && (
            <section className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
              <div className="flex items-start gap-2">
                <XCircle size={16} className="text-destructive shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-sm font-bold text-destructive">
                    ต้องแก้ไข {validationMessages.length} ข้อก่อน POST:
                  </p>
                  <ul className="mt-1 space-y-0.5 text-xs text-destructive/90">
                    {validationMessages.map((m, i) => (
                      <li key={i}>• {m}</li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    (สามารถบันทึกร่างไว้ก่อนได้)
                  </p>
                </div>
              </div>
            </section>
          )}

          {/* Section 6 — Auto Journal Preview */}
          <section className="rounded-xl border bg-card p-5">
            <SectionHeader
              num={6}
              title="AUTO JOURNAL PREVIEW"
              action={
                <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground cursor-not-allowed opacity-60">
                  <input type="checkbox" disabled className="size-3.5" />
                  แก้ไขเอง (Override)
                </label>
              }
            />
            <AutoJournalPreview lines={jeLines} />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
              <SummaryTile label="รายได้" value={incomeTotals.beforeVat} tone="primary" />
              <SummaryTile label="VAT" value={incomeTotals.vat} tone="info" />
              <SummaryTile label="WHT" value={incomeTotals.wht} tone="warning" />
              <SummaryTile label="สุทธิรับ" value={incomeTotals.net} tone="success" />
            </div>
          </section>

          {/* Section 7 — Recorder & Approver */}
          <section className="rounded-xl border bg-card p-5">
            <SectionHeader num={7} title="ผู้บันทึก & ผู้อนุมัติ" />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs italic text-muted-foreground">
                ระบบกำหนดอัตโนมัติตาม user ที่เข้าใช้งานในขณะนี้
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-info/10 text-info text-xs">
                  <CloudUpload size={13} />
                  <span className="text-muted-foreground">ผู้บันทึก:</span>
                  <span className="font-semibold text-foreground">{userDisplayName}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-success/10 text-success text-xs">
                  <CheckCircle2 size={13} />
                  <span className="text-muted-foreground">ผู้อนุมัติ:</span>
                  <span className="font-semibold text-foreground">{userDisplayName}</span>
                </span>
              </div>
            </div>
          </section>

          {/* Section 8 — Attachments */}
          <section className={`rounded-xl border p-5 ${needsAttachment ? 'border-warning bg-warning/5' : 'bg-card'}`}>
            <SectionHeader
              num={8}
              title="แนบไฟล์เอกสาร (ไม่บังคับ)"
              hint="PDF/JPG/PNG ≤ 5MB"
            />
            {!isEdit && (
              <p className="text-xs text-muted-foreground italic">
                บันทึกร่างก่อนเพื่อเปิดใช้งานการแนบไฟล์
              </p>
            )}
            {isEdit && (
              <>
                {needsAttachment && (
                  <div className="flex items-start gap-2 mb-3 text-xs text-warning">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>
                      ยอดรับ ≥ {formatNumber(attachmentThreshold)} ฿ — ต้องแนบไฟล์ประกอบเพื่อ POST
                    </span>
                  </div>
                )}
                {currentAttachments.length > 0 && (
                  <ul className="mb-3 space-y-1">
                    {currentAttachments.map((att) => (
                      <li
                        key={att.id}
                        className="flex items-center gap-2 px-3 py-2 rounded-md border bg-background text-xs"
                      >
                        <FileText size={14} className="text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate font-medium">{att.filename}</span>
                        <span className="text-muted-foreground">{(att.size / 1024).toFixed(1)} KB</span>
                      </li>
                    ))}
                  </ul>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  aria-hidden="true"
                  tabIndex={-1}
                  className="hidden"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleFileSelect(file);
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                />
                <div
                  onDragEnter={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (uploadAttachmentMutation.isPending) return;
                    setIsDraggingFile(true);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    // Ignore leave events from child elements (icon, text)
                    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                    setIsDraggingFile(false);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsDraggingFile(false);
                    if (uploadAttachmentMutation.isPending) return;
                    const file = e.dataTransfer.files?.[0];
                    if (file) handleFileSelect(file);
                  }}
                  className={`rounded-lg border-2 border-dashed transition-colors ${
                    isDraggingFile
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:bg-accent/40'
                  } ${uploadAttachmentMutation.isPending ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  <button
                    type="button"
                    disabled={uploadAttachmentMutation.isPending}
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex flex-col items-center justify-center gap-2 py-8 px-4 disabled:cursor-not-allowed"
                  >
                    <Upload
                      size={24}
                      className={isDraggingFile ? 'text-primary' : 'text-muted-foreground'}
                    />
                    <p className="text-sm text-muted-foreground">
                      ลากไฟล์มาวางที่นี่ หรือ{' '}
                      <span className="text-primary font-semibold">คลิกเพื่อเลือกไฟล์</span>
                    </p>
                  </button>
                </div>
              </>
            )}
          </section>

          {/* Section 9 — Confirmation summary */}
          <section className="rounded-xl border bg-card p-5">
            <SectionHeader num={9} title="สรุปก่อนยืนยัน" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 text-sm font-mono">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ยอดรวมก่อนหักส่วนลด</span>
                  <span className="font-semibold">{fmt(incomeTotals.beforeVat + incomeTotals.vat)} ฿</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ยอดสุทธิที่ควรได้รับ</span>
                  <span className="font-semibold">{fmt(incomeTotals.net)} ฿</span>
                </div>
              </div>
              <div className="rounded-xl bg-primary/10 p-4 text-primary">
                <p className="text-xs font-semibold opacity-80">จำนวนเงินทั้งสิ้น</p>
                <p className="text-3xl font-bold font-mono mt-1">{fmt(incomeTotals.total)} ฿</p>
                <p className="text-xs mt-2 opacity-80">
                  บัญชีรายได้: {values.items?.[0]?.accountCode || '—'}
                </p>
                <p className="text-xs opacity-80">
                  ลูกค้า: {values.counterpartyName?.trim() || '—'}
                </p>
              </div>
            </div>
            {(Number(values.amountReceived) || 0) === 0 && (
              <div className="mt-4 flex items-start gap-2 p-3 rounded-md bg-muted/40 text-xs text-muted-foreground">
                <Lightbulb size={14} className="text-warning shrink-0 mt-0.5" />
                <span>กรอก "จำนวนเงินที่ได้รับจริง" เพื่อตรวจเปรียบเทียบกับยอดสุทธิ</span>
              </div>
            )}
          </section>
        </form>
      </div>

      {/* Sticky bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-background border-t shadow-lg px-4 md:px-6 py-3">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs flex items-center gap-1.5">
            {errorCount > 0 ? (
              <span className="inline-flex items-center gap-1 text-destructive font-semibold">
                <AlertTriangle size={14} />
                มี {errorCount} ข้อต้องแก้ไข
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-success font-semibold">
                <CheckCircle2 size={14} />
                ข้อมูลพร้อม POST
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => navigate('/other-income')}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium border rounded-md hover:bg-accent"
            >
              <ArrowLeft size={14} />
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => {
                const raw = form.getValues();
                const result = otherIncomeFormSchema.safeParse(raw);
                if (!result.success) {
                  toast.error('กรุณาตรวจสอบข้อมูลให้ครบถ้วน');
                  return;
                }
                saveDraftMutation.mutate(result.data);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-semibold border rounded-md hover:bg-accent disabled:opacity-50"
            >
              <Save size={14} />
              {saveDraftMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกร่าง'}
            </button>
            <button
              type="button"
              disabled={isSubmitting || !canPost}
              title={
                needsAttachment
                  ? `ต้องแนบเอกสารเมื่อยอดรับ ≥ ${formatNumber(attachmentThreshold)} ฿`
                  : errorCount > 0
                    ? `ยังมี ${errorCount} ข้อต้องแก้ไข`
                    : undefined
              }
              onClick={() => {
                const raw = form.getValues();
                const result = otherIncomeFormSchema.safeParse(raw);
                if (!result.success) {
                  toast.error('กรุณาตรวจสอบข้อมูลให้ครบถ้วน');
                  return;
                }
                saveAndPostMutation.mutate(result.data);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-bold bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Send size={14} />
              {saveAndPostMutation.isPending ? 'กำลัง POST...' : 'บันทึก & POST'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'primary' | 'info' | 'warning' | 'success';
}) {
  const toneCls = {
    primary: 'bg-primary/5 text-primary',
    info: 'bg-info/5 text-info',
    warning: 'bg-warning/5 text-warning',
    success: 'bg-success/5 text-success',
  }[tone];
  return (
    <div className={`rounded-lg p-3 ${toneCls}`}>
      <p className="text-[10px] font-semibold tracking-wider uppercase">{label}</p>
      <p className="font-mono font-bold text-lg mt-1 text-foreground">{formatNumberDecimal(value, 2)}</p>
    </div>
  );
}
