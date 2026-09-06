import { useEffect, useState } from 'react';
import { UseMutationResult } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft, ClipboardCheck, FileText, Info, Package, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ContactCombobox, type ContactPickResult } from '@/components/contacts/ContactCombobox';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { ItemForm, ReceivingUnitForm } from '../types';
import { defaultChecklist, paymentMethodLabels } from '../constants';
import { allItemsComplete, itemLabel, type AccessorySku } from '../po-catalog.util';
import { computePoTotals } from '../poTotals';
import { useItemRows } from '../hooks/useItemRows';
import type { DirectReceiveInput } from '../hooks/usePurchaseOrdersData';
import type { CreatePOModalProps } from './CreatePOModal';
import { StepItems } from './wizard/StepItems';
import { StepSummary } from './wizard/StepSummary';
import { WizardStepper, type WizardStep } from './wizard/WizardStepper';
import { isPaidStatus, paidAmountError, type PaymentFields } from './wizard/PaymentSection';
import { ReceivingUnitCard } from './ReceivingUnitCard';
import { useReceivingDuplicates } from './useReceivingDuplicates';

export interface DirectReceiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  suppliers: CreatePOModalProps['suppliers'];
  supplierId: string;
  /** Same contact picker as the PO wizard — the parent resolves the picked contact to a supplier id. */
  onSupplierSelect: (result: ContactPickResult) => Promise<void> | void;
  /** Same row shape as the PO wizard; unitPrice = ราคาทุน/ชิ้น here. */
  lines: ItemForm[];
  setLines: React.Dispatch<React.SetStateAction<ItemForm[]>>;
  notes: string;
  setNotes: (v: string) => void;
  directReceiveMutation: UseMutationResult<unknown, unknown, DirectReceiveInput, unknown>;
  searchAccessorySkus: (search: string) => Promise<AccessorySku[]>;
}

type Step = 'lines' | 'inspect' | 'summary';
const STEP_ORDER: Step[] = ['lines', 'inspect', 'summary'];
const STEPS: WizardStep[] = [
  { label: 'เพิ่มรายการ', icon: Package },
  { label: 'ตรวจรับ', icon: ClipboardCheck },
  { label: 'สรุป + จ่ายเงิน', icon: FileText },
];
const TITLES: Record<Step, string> = {
  lines: 'รับเข้าตรง (supplier)',
  inspect: 'รับเข้าตรง — ตรวจรับ',
  summary: 'รับเข้าตรง — สรุป + จ่ายเงิน',
};
const WIDTHS: Record<Step, string> = { lines: 'max-w-7xl', inspect: 'max-w-3xl', summary: 'max-w-4xl' };

/** Discount + payment keyed in on step 3 — the same fields the PO wizard's last step holds. */
type MoneyForm = PaymentFields & { discount: string; discountAfterVat: string };
const emptyMoney = (): MoneyForm => ({
  discount: '',
  discountAfterVat: '',
  paymentStatus: 'UNPAID',
  paymentMethod: '',
  paidAmount: '',
  paymentNotes: '',
});

const card = 'rounded-xl border border-border/50 bg-card p-5 shadow-sm';
const primaryBtn =
  'px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm whitespace-nowrap';
const outlineBtn = 'px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors';

/** One table row → `quantity` units for the ตรวจรับ step (label = the same name the PO wizard shows). */
export function lineToUnits(item: ItemForm): ReceivingUnitForm[] {
  const qty = Math.max(1, Math.floor(Number(item.quantity)) || 1);
  const label = itemLabel(item) || 'สินค้า';
  return Array.from({ length: qty }, (_, i) => ({
    poItemId: '',
    label: `${label} #${i + 1}`,
    category: item.category,
    brand: item.brand,
    model: item.model,
    color: item.color,
    storage: item.storage,
    accessoryType: item.accessoryType,
    accessoryBrand: item.accessoryBrand,
    imeiSerial: '',
    serialNumber: '',
    status: 'PASS',
    rejectReason: '',
    defectReason: '',
    batteryHealth: '',
    warrantyExpired: false,
    warrantyExpireDate: '',
    hasBox: true,
    checklist: defaultChecklist.map((c) => ({ ...c, passed: true, note: '' })),
    sellingPrice: '',
    photos: [],
    costPrice: item.unitPrice,
  }));
}

/**
 * รับเข้าตรง — goods bought without a PO, received on the spot. Three steps (owner 2026-09-06):
 * ① เพิ่มรายการ — the PO wizard's picker + items table with cost-price wording; ② ตรวจรับ — one
 * card per unit (IMEI / selling price / photos); ③ สรุป + จ่ายเงิน — the wizard's summary step
 * (discount / VAT / payment / slips / notes), and that is where the confirm button lives, so a
 * cash purchase is booked paid right here. No submit-type button anywhere (see CreatePOModal
 * for the mid-click type flip that bit us).
 */
export function DirectReceiveModal(props: DirectReceiveModalProps) {
  const {
    isOpen,
    onClose,
    suppliers,
    supplierId,
    onSupplierSelect,
    lines,
    setLines,
    notes,
    setNotes,
    directReceiveMutation,
    searchAccessorySkus,
  } = props;
  const isMobile = useIsMobile();
  const [step, setStep] = useState<Step>('lines');
  const [units, setUnits] = useState<ReceivingUnitForm[]>([]);
  const [money, setMoney] = useState<MoneyForm>(emptyMoney);
  const [attachments, setAttachments] = useState<string[]>([]);
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const dupIndices = useReceivingDuplicates(units);
  const rows = useItemRows(lines, setLines);

  // Fresh wizard every time it opens (the parent already resets lines / supplier / notes)
  useEffect(() => {
    if (!isOpen) return;
    setStep('lines');
    setUnits([]);
    setMoney(emptyMoney());
    setAttachments([]);
    setAttachmentUrl('');
  }, [isOpen]);

  if (!isOpen) return null;

  const today = new Date().toISOString().split('T')[0];
  const selectedSupplier = suppliers.find((s) => s.id === supplierId);
  const supplierHasVat = selectedSupplier?.hasVat ?? false;
  const defaultPm = selectedSupplier?.paymentMethods.find((pm) => pm.isDefault) ?? selectedSupplier?.paymentMethods[0];
  const pieces = lines.reduce((n, i) => n + (Number(i.quantity) || 0), 0);
  const subtotal = lines.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unitPrice) || 0), 0);
  const complete = allItemsComplete(lines);
  const canNext = !!supplierId && complete;
  const nextLabel = pieces > 0 ? `ถัดไป: ตรวจรับ ${pieces} ชิ้น` : 'ถัดไป: ตรวจรับ';
  const nextHint = !supplierId
    ? 'เลือกผู้ขายก่อน'
    : lines.length === 0
      ? 'เพิ่มอย่างน้อย 1 รายการ'
      : !complete
        ? 'กรอกจำนวนและราคาทุนให้ครบทุกรายการ'
        : 'ขั้นถัดไปกรอก IMEI · ราคาขาย · รูป ทีละชิ้น';

  const totals = computePoTotals({ items: lines, discount: money.discount, discountAfterVat: money.discountAfterVat, supplierHasVat });
  const passed = units.filter((u) => u.status === 'PASS').length;
  const rejected = units.length - passed;

  // Credit-term due date, same rule as the PO wizard (orderDate = today for a direct receive)
  const selectedPm = money.paymentMethod
    ? selectedSupplier?.paymentMethods.find((pm) => pm.paymentMethod === money.paymentMethod)
    : defaultPm;
  let dueDatePreview: Date | null = null;
  if (selectedPm?.creditTermDays) {
    dueDatePreview = new Date(today);
    dueDatePreview.setDate(dueDatePreview.getDate() + selectedPm.creditTermDays);
  }

  const updateUnit = (idx: number, field: string, value: string) =>
    setUnits((prev) =>
      prev.map((u, i) => {
        if (i !== idx) return u;
        const boolFields = ['hasBox', 'warrantyExpired'];
        return { ...u, [field]: boolFields.includes(field) ? value === 'true' : value };
      }),
    );

  const updateUnitChecklist = (unitIdx: number, checkIdx: number, field: 'passed' | 'note', value: boolean | string) =>
    setUnits((prev) =>
      prev.map((u, i) =>
        i !== unitIdx ? u : { ...u, checklist: u.checklist.map((c, ci) => (ci === checkIdx ? { ...c, [field]: value } : c)) },
      ),
    );

  const onAddPhotos = (idx: number, files: FileList) =>
    Array.from(files)
      .slice(0, 6)
      .forEach((file) => {
        const reader = new FileReader();
        reader.onload = () =>
          setUnits((prev) =>
            prev.map((u, i) => (i === idx && u.photos.length < 6 ? { ...u, photos: [...u.photos, reader.result as string] } : u)),
          );
        reader.readAsDataURL(file);
      });

  const onRemovePhoto = (idx: number, photoIdx: number) =>
    setUnits((prev) => prev.map((u, i) => (i === idx ? { ...u, photos: u.photos.filter((_, p) => p !== photoIdx) } : u)));

  const goInspect = () => {
    if (!canNext) return;
    setUnits(lines.flatMap(lineToUnits));
    setStep('inspect');
  };

  /** ตรวจรับ → สรุป: every unit must be inspectable before the money is keyed in. */
  const goSummary = () => {
    const passUnits = units.filter((u) => u.status === 'PASS');
    if (passUnits.some((u) => u.category !== 'ACCESSORY' && !u.imeiSerial.trim())) {
      toast.error('กรุณาระบุ IMEI ให้ครบทุกเครื่องที่ผ่าน');
      return;
    }
    if (passUnits.some((u) => !u.sellingPrice.trim() || Number(u.sellingPrice) <= 0)) {
      toast.error('กรุณาระบุราคาขายให้ครบทุกเครื่องที่ผ่าน');
      return;
    }
    if (units.some((u) => u.status === 'REJECT' && !u.defectReason)) {
      toast.error('กรุณาเลือกสาเหตุที่ไม่ผ่านให้ครบ');
      return;
    }
    if (dupIndices.size > 0) {
      toast.error('มี IMEI ซ้ำกันในรายการ กรุณาแก้ไขก่อนบันทึก');
      return;
    }
    // default the payment method once the supplier is known (the picker can change it later)
    setMoney((m) => ({ ...m, paymentMethod: m.paymentMethod || defaultPm?.paymentMethod || '' }));
    setStep('summary');
  };

  const submit = () => {
    const paid = isPaidStatus(money.paymentStatus);
    const amountError = paidAmountError(money, totals.netAmount);
    if (paid && amountError) {
      toast.error(amountError);
      return;
    }
    directReceiveMutation.mutate({
      supplierId,
      orderDate: today,
      notes,
      items: units,
      discount: money.discount ? Number(money.discount) : undefined,
      discountAfterVat: money.discountAfterVat ? Number(money.discountAfterVat) : undefined,
      ...(paid
        ? {
            paymentStatus: money.paymentStatus,
            paymentMethod: money.paymentMethod || undefined,
            paidAmount: Number(money.paidAmount),
            paymentNotes: money.paymentNotes || undefined,
            attachments: attachments.length > 0 ? attachments : undefined,
          }
        : {}),
    });
  };

  const linesBody = (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-5">
        <section className={card}>
          <div className="mb-4 flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-success/10 text-success">
              <Users className="size-4.5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold leading-snug text-foreground">ผู้ขาย</h3>
              <p className="text-xs leading-snug text-muted-foreground">รับของจากใคร — ค้นหาจากรายชื่อผู้ติดต่อ หรือสร้างใหม่ได้จากช่องเดียวกัน</p>
            </div>
          </div>
          <div className="max-w-xl">
            <label className="mb-2 block text-2xs font-medium uppercase tracking-wider text-muted-foreground">
              ผู้ขาย (supplier) <span className="text-destructive">*</span>
            </label>
            <ContactCombobox
              roleNeeded="SUPPLIER"
              value={selectedSupplier?.name ?? ''}
              onSelect={onSupplierSelect}
              placeholder="เลือก/ค้นหาผู้จัดจำหน่าย"
            />
            {selectedSupplier && (
              <p className="mt-2 text-xs leading-snug text-muted-foreground">
                {selectedSupplier.hasVat ? 'มี VAT 7%' : 'ไม่มี VAT'}
                {defaultPm ? ` · วิธีจ่ายค่าเริ่มต้น: ${paymentMethodLabels[defaultPm.paymentMethod] ?? defaultPm.paymentMethod}` : ''}
              </p>
            )}
          </div>
        </section>

        <StepItems
          items={lines}
          {...rows}
          searchAccessorySkus={searchAccessorySkus}
          subtotal={subtotal}
          labels={{
            title: 'รายการที่รับเข้า',
            hint: 'ค้นหารุ่นแล้วกดเพิ่ม — สภาพ / ความจุ / สี / จำนวน / ราคาทุน เลือกในตาราง · อุปกรณ์เสริมค้นจากสินค้าเดิมหรือสร้างรายการใหม่',
            price: 'ราคาทุน/ชิ้น',
            total: 'รวมทุน',
            footerTotal: 'ต้นทุนรวม',
          }}
        />
      </div>
      <div className="shrink-0 border-t bg-background/95 px-4 py-4 sm:px-6 flex items-center justify-between gap-3">
        <button type="button" onClick={onClose} className={outlineBtn}>
          ยกเลิก
        </button>
        <div className="flex items-center gap-4">
          <span className="hidden items-center gap-1.5 text-xs leading-snug text-muted-foreground sm:inline-flex">
            <Info className="size-3.5 shrink-0" />
            {nextHint}
          </span>
          <button type="button" onClick={goInspect} disabled={!canNext} className={primaryBtn}>
            {nextLabel}
          </button>
        </div>
      </div>
    </div>
  );

  const inspectBody = (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="shrink-0 border-b px-4 py-2 sm:px-6">
        <button type="button" onClick={() => setStep('lines')} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" /> กลับไปแก้รายการ
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
        {units.map((unit, idx) => (
          <ReceivingUnitCard
            key={idx}
            unit={unit}
            idx={idx}
            isDuplicate={dupIndices.has(idx)}
            showCostPrice
            updateReceivingUnit={updateUnit}
            updateChecklist={updateUnitChecklist}
            onAddPhotos={onAddPhotos}
            onRemovePhoto={onRemovePhoto}
          />
        ))}
      </div>
      <div className="shrink-0 border-t bg-background/95 px-4 py-4 sm:px-6 flex items-center justify-between gap-3">
        <button type="button" onClick={() => setStep('lines')} className={outlineBtn}>
          ย้อนกลับ
        </button>
        <div className="flex items-center gap-4">
          <span className="hidden items-center gap-1.5 text-xs leading-snug text-muted-foreground sm:inline-flex">
            <Info className="size-3.5 shrink-0" />
            ขั้นถัดไปคิดส่วนลด / VAT และบันทึกการจ่ายเงิน — ปุ่มยืนยันอยู่ที่นั่น
          </span>
          <button type="button" onClick={goSummary} className={primaryBtn}>
            ถัดไป: สรุป + จ่ายเงิน
          </button>
        </div>
      </div>
    </div>
  );

  // StepSummary edits one form object; here that object is stitched from the parent's notes +
  // the local money state, and its writes are split back the same way.
  const summaryForm: CreatePOModalProps['form'] = { supplierId, orderDate: today, expectedDate: '', notes, ...money };
  const setSummaryForm: CreatePOModalProps['setForm'] = (action) => {
    const next = typeof action === 'function' ? action(summaryForm) : action;
    if (next.notes !== notes) setNotes(next.notes);
    setMoney({
      discount: next.discount,
      discountAfterVat: next.discountAfterVat,
      paymentStatus: next.paymentStatus,
      paymentMethod: next.paymentMethod,
      paidAmount: next.paidAmount,
      paymentNotes: next.paymentNotes,
    });
  };

  const summaryBody = (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <StepSummary
          form={summaryForm}
          setForm={setSummaryForm}
          items={lines}
          selectedSupplier={selectedSupplier}
          supplierHasVat={supplierHasVat}
          totals={totals}
          dueDatePreview={dueDatePreview}
          attachmentUrl={attachmentUrl}
          setAttachmentUrl={setAttachmentUrl}
          formAttachments={attachments}
          setFormAttachments={setAttachments}
          onEditItems={() => setStep('lines')}
          receive={{ passed, rejected }}
        />
      </div>
      <div className="shrink-0 border-t bg-background/95 px-4 py-4 sm:px-6 flex items-center justify-between gap-3">
        <button type="button" onClick={() => setStep('inspect')} className={outlineBtn}>
          ย้อนกลับ
        </button>
        <button type="button" onClick={submit} disabled={directReceiveMutation.isPending} className={primaryBtn}>
          {directReceiveMutation.isPending ? 'กำลังรับเข้า…' : `ยืนยันรับเข้าตรง ${units.length} ชิ้น`}
        </button>
      </div>
    </div>
  );

  const body = step === 'lines' ? linesBody : step === 'inspect' ? inspectBody : summaryBody;
  const title = TITLES[step];
  const stepper = (
    <WizardStepper steps={STEPS} current={STEP_ORDER.indexOf(step)} onStepClick={(i) => setStep(STEP_ORDER[i] ?? 'lines')} />
  );

  if (isMobile) {
    return (
      <Drawer
        open={isOpen}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
      >
        <DrawerContent className="h-[92dvh]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="leading-snug">{title}</DrawerTitle>
            <div className="pt-2">{stepper}</div>
          </DrawerHeader>
          {body}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8"
      role="dialog"
      aria-modal="true"
      aria-label="รับเข้าตรง"
    >
      {/* 7xl on the items step (same table as the PO wizard); the per-unit cards and the summary keep narrower frames */}
      <div className={cn('w-full bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]', WIDTHS[step])}>
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between shrink-0">
          <button type="button" onClick={onClose} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="size-4" />
            ปิด
          </button>
          <h2 className="text-lg font-semibold text-foreground leading-snug">{title}</h2>
          <div className="w-16" />
        </div>
        <div className="px-6 pt-4 shrink-0">{stepper}</div>
        {body}
      </div>
    </div>
  );
}
