import { useState } from 'react';
import { UseMutationResult } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft, ClipboardCheck, Info, Package, StickyNote, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ContactCombobox, type ContactPickResult } from '@/components/contacts/ContactCombobox';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { ItemForm, ReceivingUnitForm } from '../types';
import { defaultChecklist, paymentMethodLabels } from '../constants';
import { allItemsComplete, itemLabel, type AccessorySku } from '../po-catalog.util';
import { useItemRows } from '../hooks/useItemRows';
import type { CreatePOModalProps } from './CreatePOModal';
import { StepItems } from './wizard/StepItems';
import { WizardStepper, type WizardStep } from './wizard/WizardStepper';
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
  directReceiveMutation: UseMutationResult<
    unknown,
    unknown,
    { supplierId: string; orderDate: string; notes?: string; items: ReceivingUnitForm[] },
    unknown
  >;
  searchAccessorySkus: (search: string) => Promise<AccessorySku[]>;
}

const STEPS: WizardStep[] = [
  { label: 'เพิ่มรายการ', icon: Package },
  { label: 'ตรวจรับ', icon: ClipboardCheck },
];

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
 * รับเข้าตรง — goods bought without a PO, received on the spot. Step 1 reuses the PO wizard's
 * picker + items table (owner 2026-09-06) with cost-price wording; step 2 (ตรวจรับ, one card per
 * unit: IMEI / selling price / photos) is unchanged. No submit-type button anywhere: ถัดไป and
 * ยืนยัน are plain buttons (see CreatePOModal for the mid-click type flip that bit us).
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
  const [step, setStep] = useState<'lines' | 'inspect'>('lines');
  const [units, setUnits] = useState<ReceivingUnitForm[]>([]);
  const dupIndices = useReceivingDuplicates(units);
  const rows = useItemRows(lines, setLines);

  if (!isOpen) return null;

  const selectedSupplier = suppliers.find((s) => s.id === supplierId);
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

  const submit = () => {
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
    directReceiveMutation.mutate({
      supplierId,
      orderDate: new Date().toISOString().split('T')[0],
      notes,
      items: units,
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

        <section className={card}>
          <div className="mb-4 flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <StickyNote className="size-4.5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold leading-snug text-foreground">หมายเหตุ</h3>
              <p className="text-xs leading-snug text-muted-foreground">ถ้ามี — ติดไปกับใบรับเข้า</p>
            </div>
          </div>
          <textarea
            aria-label="หมายเหตุ"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm leading-snug outline-hidden placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30"
            placeholder="บันทึกเพิ่มเติม เช่น รับจากหน้าร้านสาขาลาดพร้าว"
          />
        </section>
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
        <button type="button" onClick={submit} disabled={directReceiveMutation.isPending} className={primaryBtn}>
          {directReceiveMutation.isPending ? 'กำลังรับเข้า…' : `ยืนยันรับเข้าตรง ${units.length} ชิ้น`}
        </button>
      </div>
    </div>
  );

  const body = step === 'lines' ? linesBody : inspectBody;
  const title = step === 'lines' ? 'รับเข้าตรง (supplier)' : 'รับเข้าตรง — ตรวจรับ';
  const stepper = <WizardStepper steps={STEPS} current={step === 'lines' ? 0 : 1} onStepClick={() => setStep('lines')} />;

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
      {/* 7xl on the items step (same table as the PO wizard); the per-unit inspect cards keep the narrower frame */}
      <div className={cn('w-full bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]', step === 'lines' ? 'max-w-7xl' : 'max-w-3xl')}>
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
