import { useMemo, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Save, Send, ArrowLeft, Receipt, FileText, Paperclip, AlertTriangle } from 'lucide-react';
import PageHeader from '@/components/ui/PageHeader';
import QueryBoundary from '@/components/QueryBoundary';
import { otherIncomeApi } from '@/lib/otherIncome';
import { otherIncomeFormSchema, type OtherIncomeFormValues } from '@/lib/otherIncome.schema';
import { ItemsTable } from './components/ItemsTable';
import { AdjustmentTable } from './components/AdjustmentTable';
import { AutoJournalPreview } from './components/AutoJournalPreview';
import { PaymentCompareCard } from './components/PaymentCompareCard';
import { CounterpartyPicker } from './components/CounterpartyPicker';

// Threshold above which attachment is required (matches backend SystemConfig default)
const ATTACHMENT_THRESHOLD = 50_000;

// ------------------------------------------------------------------
// JE preview computation — mirrors AutoJournalService on the backend
// ------------------------------------------------------------------
interface JeLine {
  accountCode: string;
  debit: number;
  credit: number;
  description?: string;
}

function computeJePreview(values: OtherIncomeFormValues): JeLine[] {
  const lines: JeLine[] = [];
  if (!values.items || values.items.length === 0) return lines;

  let totalAmountBeforeVat = 0;
  let totalVat = 0;
  let totalWht = 0;

  for (const item of values.items) {
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

    // Cr revenue account (42-XXXX)
    if (amountBeforeVat > 0) {
      lines.push({
        accountCode: item.accountCode || '42-XXXX',
        debit: 0,
        credit: +amountBeforeVat.toFixed(2),
        description: item.description || undefined,
      });
    }
  }

  // Cr VAT output (21-2101) if any
  if (totalVat > 0) {
    lines.push({
      accountCode: '21-2101',
      debit: 0,
      credit: +totalVat.toFixed(2),
      description: 'ภาษีขาย',
    });
  }

  // Dr WHT payable (21-3101) if any
  if (totalWht > 0) {
    lines.push({
      accountCode: '21-3101',
      debit: 0,
      credit: +totalWht.toFixed(2),
      description: 'ภาษีหัก ณ ที่จ่าย',
    });
  }

  // Adjustments (Dr/Cr depending on over/under)
  const amountReceived = Number(values.amountReceived) || 0;
  const netExpected = +(totalAmountBeforeVat + totalVat - totalWht).toFixed(2);
  const diff = +(amountReceived - netExpected).toFixed(2);

  if (values.adjustments && values.adjustments.length > 0) {
    for (const adj of values.adjustments) {
      const amt = Number(adj.amount) || 0;
      if (amt > 0 && adj.accountCode) {
        if (diff > 0) {
          // received more → Cr adjustment account
          lines.push({ accountCode: adj.accountCode, debit: 0, credit: +amt.toFixed(2), description: adj.note || undefined });
        } else {
          // received less → Dr adjustment account (expense/discount)
          lines.push({ accountCode: adj.accountCode, debit: +amt.toFixed(2), credit: 0, description: adj.note || undefined });
        }
      }
    }
  }

  // Dr cash/bank received
  if (amountReceived > 0) {
    lines.push({
      accountCode: values.paymentAccountCode || '11-1201',
      debit: +amountReceived.toFixed(2),
      credit: 0,
      description: 'รับเงิน',
    });
  }

  return lines;
}

// ------------------------------------------------------------------

const defaultValues: OtherIncomeFormValues = {
  issueDate: new Date().toISOString().slice(0, 10),
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
  { code: '11-1101', label: '11-1101 เงินสด — สุทธินีย์' },
  { code: '11-1102', label: '11-1102 เงินสด — เอกนรินทร์' },
  { code: '11-1103', label: '11-1103 เงินสด — พนักงานบัญชี' },
  { code: '11-1201', label: '11-1201 ธนาคาร KBank' },
  { code: '11-1202', label: '11-1202 ธนาคาร SCB (ค่าใช้จ่าย)' },
  { code: '11-1203', label: '11-1203 ธนาคาร SCB (ค่าเสื่อม)' },
];

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
    defaultValues,
  });

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
  const { netExpected, totalDiff, diffSign } = useMemo(() => {
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
    return { netExpected: net, totalDiff: +Math.abs(diff).toFixed(2), diffSign: sign };
  }, [values]);

  const watchedAdjustments = form.watch('adjustments') ?? [];

  const isSubmitting = saveDraftMutation.isPending || saveAndPostMutation.isPending;

  // B7: Attachment uploader (only available after doc is saved and has an id)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploadAttachmentMutation = useMutation({
    mutationFn: (file: File) => otherIncomeApi.uploadAttachment(id!, file),
    onSuccess: () => {
      toast.success('แนบไฟล์เรียบร้อยแล้ว');
      queryClient.invalidateQueries({ queryKey: ['other-income', id] });
    },
    onError: () => toast.error('ไม่สามารถแนบไฟล์ได้'),
  });

  const currentAttachments = loadQuery.data?.attachments ?? [];
  const amountReceived = Number(values.amountReceived) || 0;
  const needsAttachment = amountReceived >= ATTACHMENT_THRESHOLD && currentAttachments.length === 0;

  return (
    <div className="pb-32">
      <div className="p-6 max-w-7xl mx-auto">
        <PageHeader
          title={isEdit ? 'แก้ไขเอกสารรายได้อื่น' : 'สร้างเอกสารรายได้อื่น'}
          subtitle="กรอกข้อมูลรายได้พร้อม JE Preview อัตโนมัติ"
          icon={<Receipt size={20} />}
          onBack={() => navigate('/other-income')}
        />

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

        <form
          onSubmit={(e) => e.preventDefault()}
          className="grid grid-cols-1 xl:grid-cols-3 gap-6"
        >
          {/* Left / Main column */}
          <div className="xl:col-span-2 space-y-6">
            {/* --- Header section --- */}
            <div className="rounded-xl border bg-card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                ข้อมูลเอกสาร
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">วันที่เอกสาร *</label>
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
                  <label className="text-xs font-medium text-muted-foreground">วันครบกำหนด</label>
                  <input
                    type="date"
                    {...form.register('dueDate')}
                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-background"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">วันที่รับเงิน</label>
                  <input
                    type="date"
                    {...form.register('paymentDate')}
                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-background"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">ประเภทราคา</label>
                  <select
                    {...form.register('priceType')}
                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-background"
                  >
                    <option value="EXCLUSIVE">ราคาไม่รวม VAT (EXCLUSIVE)</option>
                    <option value="INCLUSIVE">ราคารวม VAT (INCLUSIVE)</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">ช่องทางรับเงิน *</label>
                  <select
                    {...form.register('paymentAccountCode')}
                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-background"
                  >
                    {PAYMENT_ACCOUNTS.map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                  {form.formState.errors.paymentAccountCode && (
                    <p className="text-xs text-destructive mt-1">
                      {form.formState.errors.paymentAccountCode.message}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* --- Counterparty section --- */}
            <div className="rounded-xl border bg-card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                คู่ค้า / ลูกค้า
              </h2>
              <CounterpartyPicker
                value={{
                  customerId: values.customerId ?? null,
                  name: values.counterpartyName ?? '',
                  taxId: values.counterpartyTaxId,
                  address: values.counterpartyAddress,
                  phone: values.counterpartyPhone,
                }}
                onChange={(cp) => {
                  form.setValue('customerId', cp.customerId ?? '', { shouldDirty: true });
                  form.setValue('counterpartyName', cp.name, { shouldDirty: true });
                  form.setValue('counterpartyTaxId', cp.taxId ?? '', { shouldDirty: true });
                  form.setValue('counterpartyAddress', cp.address ?? '', { shouldDirty: true });
                  form.setValue('counterpartyPhone', cp.phone ?? '', { shouldDirty: true });
                }}
              />
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-medium text-muted-foreground">เลขที่ผู้เสียภาษี</label>
                  <input
                    type="text"
                    {...form.register('counterpartyTaxId')}
                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-background"
                    placeholder="13 หลัก"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">เบอร์โทร</label>
                  <input
                    type="text"
                    {...form.register('counterpartyPhone')}
                    className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-background"
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground">ที่อยู่</label>
                <textarea
                  {...form.register('counterpartyAddress')}
                  rows={2}
                  className="mt-1 w-full border rounded-md px-3 py-2 text-sm bg-background"
                />
              </div>
            </div>

            {/* --- Items section --- */}
            <div className="rounded-xl border bg-card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                รายการรายได้
              </h2>
              {form.formState.errors.items && (
                <p className="text-xs text-destructive">
                  {typeof form.formState.errors.items?.message === 'string'
                    ? form.formState.errors.items.message
                    : 'กรุณาเพิ่มอย่างน้อย 1 รายการ'}
                </p>
              )}
              <ItemsTable
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                control={form.control as any}
                register={form.register}
                watch={form.watch}
                setValue={form.setValue}
              />
            </div>

            {/* --- Amount received vs net --- */}
            <div className="rounded-xl border bg-card p-5 space-y-4">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                ยอดเงินที่ได้รับจริง
              </h2>
              <div>
                <label className="text-xs font-medium text-muted-foreground">จำนวนเงินที่ได้รับ (฿)</label>
                <input
                  type="number"
                  step="0.01"
                  {...form.register('amountReceived')}
                  className="mt-1 w-full border rounded-md px-3 py-2 text-sm font-mono bg-background"
                  placeholder="0.00"
                />
                {form.formState.errors.amountReceived && (
                  <p className="text-xs text-destructive mt-1">
                    {form.formState.errors.amountReceived.message}
                  </p>
                )}
              </div>
              <PaymentCompareCard expected={netExpected} received={Number(values.amountReceived) || null} />

              {/* Adjustment table — only when there's a diff */}
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

            {/* --- Note --- */}
            <div className="rounded-xl border bg-card p-5">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                หมายเหตุ
              </h2>
              <textarea
                {...form.register('customerNote')}
                rows={3}
                placeholder="หมายเหตุสำหรับลูกค้า / ใบเสร็จ (optional)"
                className="w-full border rounded-md px-3 py-2 text-sm bg-background"
              />
            </div>

            {/* --- B7: Attachment section (visible in edit mode when doc exists) --- */}
            {isEdit && (
              <div className={`rounded-xl border p-5 space-y-3 ${needsAttachment ? 'border-warning bg-warning/5' : 'bg-card'}`}>
                <div className="flex items-center gap-2">
                  <Paperclip size={16} className={needsAttachment ? 'text-warning' : 'text-muted-foreground'} />
                  <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                    เอกสารแนบ
                  </h2>
                </div>
                {needsAttachment && (
                  <div className="flex items-start gap-2 text-xs text-warning">
                    <AlertTriangle size={14} className="shrink-0 mt-0.5" />
                    <span>ยอดรับ ≥ {ATTACHMENT_THRESHOLD.toLocaleString()} ฿ — ต้องแนบไฟล์ประกอบเพื่อ POST</span>
                  </div>
                )}
                {/* Existing attachments */}
                {currentAttachments.length > 0 && (
                  <ul className="space-y-1">
                    {currentAttachments.map((att) => (
                      <li key={att.id} className="flex items-center gap-2 text-xs">
                        <FileText size={12} className="text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate">{att.filename}</span>
                        <span className="text-muted-foreground">
                          {(att.size / 1024).toFixed(1)} KB
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {/* Upload button */}
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) uploadAttachmentMutation.mutate(file);
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                  />
                  <button
                    type="button"
                    disabled={uploadAttachmentMutation.isPending}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-2 px-3 py-2 text-xs font-semibold border rounded-md hover:bg-accent disabled:opacity-50"
                  >
                    <Paperclip size={12} />
                    {uploadAttachmentMutation.isPending ? 'กำลังอัปโหลด...' : 'แนบไฟล์'}
                  </button>
                  <p className="text-xs text-muted-foreground mt-1">
                    รองรับ PDF, รูปภาพ, Word — ขนาดสูงสุด 20 MB
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Right column — JE Preview */}
          <div className="space-y-4 xl:sticky xl:top-6 xl:self-start">
            <div className="rounded-xl border bg-card p-5">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">
                สรุปยอด
              </h2>
              <div className="space-y-2 font-mono text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">รายได้ก่อนภาษี</span>
                  <span className="font-semibold">
                    {(values.items ?? [])
                      .reduce((s, item) => {
                        const qty = Number(item.quantity) || 0;
                        const unit = Number(item.unitAmount) || 0;
                        const disc = Number(item.discountAmount) || 0;
                        const vatPct = Number(item.vatPct) || 0;
                        const gross = qty * unit - disc;
                        if (vatPct > 0 && values.priceType === 'INCLUSIVE') {
                          return s + +(gross / (1 + vatPct / 100)).toFixed(2);
                        }
                        return s + gross;
                      }, 0)
                      .toFixed(2)}{' '}
                    ฿
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">VAT</span>
                  <span>
                    {jeLines
                      .filter((l) => l.accountCode === '21-2101')
                      .reduce((s, l) => s + l.credit, 0)
                      .toFixed(2)}{' '}
                    ฿
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">WHT</span>
                  <span>
                    -{jeLines
                      .filter((l) => l.accountCode === '21-3101')
                      .reduce((s, l) => s + l.credit, 0)
                      .toFixed(2)}{' '}
                    ฿
                  </span>
                </div>
                <div className="flex justify-between border-t pt-2 font-bold">
                  <span>สุทธิที่คาดรับ</span>
                  <span>{netExpected.toFixed(2)} ฿</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">ได้รับจริง</span>
                  <span>{(Number(values.amountReceived) || 0).toFixed(2)} ฿</span>
                </div>
              </div>
            </div>

            <AutoJournalPreview lines={jeLines} />
          </div>
        </form>
      </div>

      {/* Sticky bottom action bar */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-background border-t shadow-lg px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => navigate('/other-income')}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium border rounded-lg hover:bg-accent"
          >
            <ArrowLeft size={16} />
            ยกเลิก
          </button>
          <div className="flex items-center gap-3">
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
              className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold border rounded-lg hover:bg-accent disabled:opacity-50"
            >
              <Save size={16} />
              {saveDraftMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกร่าง'}
            </button>
            {(() => {
              const errors = form.formState.errors;
              const errorKeys = Object.keys(errors);
              const hasErrors = errorKeys.length > 0;
              const tooltipMsg = hasErrors
                ? `ฟิลด์ที่ยังไม่ผ่าน: ${errorKeys.join(', ')}`
                : undefined;
              return (
                <button
                  type="button"
                  disabled={isSubmitting || hasErrors}
                  title={tooltipMsg}
                  onClick={() => {
                    const raw = form.getValues();
                    const result = otherIncomeFormSchema.safeParse(raw);
                    if (!result.success) {
                      toast.error('กรุณาตรวจสอบข้อมูลให้ครบถ้วน');
                      return;
                    }
                    saveAndPostMutation.mutate(result.data);
                  }}
                  className="inline-flex items-center gap-2 px-5 py-2 text-sm font-bold bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50"
                >
                  <Send size={16} />
                  {saveAndPostMutation.isPending ? 'กำลัง POST...' : 'บันทึก & POST'}
                </button>
              );
            })()}
          </div>
        </div>
      </div>
    </div>
  );
}
