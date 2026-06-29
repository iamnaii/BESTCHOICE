import { useState } from 'react';
import { UseMutationResult } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ReceivingUnitForm, DirectReceiveLineForm } from '../types';
import { defaultChecklist } from '../constants';
import { ReceivingUnitCard } from './ReceivingUnitCard';
import { useReceivingDuplicates } from './useReceivingDuplicates';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { Plus, Trash2, ChevronLeft } from 'lucide-react';

interface SupplierLite {
  id: string;
  name: string;
}

export interface DirectReceiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  suppliers: SupplierLite[];
  supplierId: string;
  setSupplierId: (v: string) => void;
  lines: DirectReceiveLineForm[];
  setLines: React.Dispatch<React.SetStateAction<DirectReceiveLineForm[]>>;
  notes: string;
  setNotes: (v: string) => void;
  directReceiveMutation: UseMutationResult<
    unknown,
    unknown,
    { supplierId: string; orderDate: string; notes?: string; items: ReceivingUnitForm[] },
    unknown
  >;
}

const emptyLine: DirectReceiveLineForm = {
  category: 'PHONE_NEW',
  brand: '',
  model: '',
  color: '',
  storage: '',
  accessoryType: '',
  accessoryBrand: '',
  quantity: '1',
  costPrice: '',
};

const fieldInput =
  'w-full min-h-11 px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 outline-hidden';

function lineToUnits(line: DirectReceiveLineForm): ReceivingUnitForm[] {
  const qty = Math.max(1, Number(line.quantity) || 1);
  const isAccessory = line.category === 'ACCESSORY';
  const label = (
    isAccessory
      ? [line.accessoryType, line.accessoryBrand, line.model]
      : [line.brand, line.model, line.color, line.storage]
  )
    .filter(Boolean)
    .join(' ');
  return Array.from({ length: qty }, (_, i) => ({
    poItemId: '',
    label: `${label || 'สินค้า'} #${i + 1}`,
    category: line.category,
    brand: line.brand,
    model: line.model,
    color: line.color,
    storage: line.storage,
    accessoryType: line.accessoryType,
    accessoryBrand: line.accessoryBrand,
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
    costPrice: line.costPrice,
  }));
}

export function DirectReceiveModal(props: DirectReceiveModalProps) {
  const {
    isOpen,
    onClose,
    suppliers,
    supplierId,
    setSupplierId,
    lines,
    setLines,
    notes,
    setNotes,
    directReceiveMutation,
  } = props;
  const isMobile = useIsMobile();
  const [step, setStep] = useState<'lines' | 'inspect'>('lines');
  const [units, setUnits] = useState<ReceivingUnitForm[]>([]);
  const dupIndices = useReceivingDuplicates(units);

  if (!isOpen) return null;

  const updateLine = (idx: number, field: keyof DirectReceiveLineForm, value: string) =>
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));

  const updateUnit = (idx: number, field: string, value: string) =>
    setUnits((prev) =>
      prev.map((u, i) => {
        if (i !== idx) return u;
        const boolFields = ['hasBox', 'warrantyExpired'];
        return { ...u, [field]: boolFields.includes(field) ? value === 'true' : value };
      }),
    );

  const updateUnitChecklist = (
    unitIdx: number,
    checkIdx: number,
    field: 'passed' | 'note',
    value: boolean | string,
  ) =>
    setUnits((prev) =>
      prev.map((u, i) =>
        i !== unitIdx
          ? u
          : {
              ...u,
              checklist: u.checklist.map((c, ci) =>
                ci === checkIdx ? { ...c, [field]: value } : c,
              ),
            },
      ),
    );

  const onAddPhotos = (idx: number, files: FileList) =>
    Array.from(files)
      .slice(0, 6)
      .forEach((file) => {
        const reader = new FileReader();
        reader.onload = () =>
          setUnits((prev) =>
            prev.map((u, i) =>
              i === idx && u.photos.length < 6
                ? { ...u, photos: [...u.photos, reader.result as string] }
                : u,
            ),
          );
        reader.readAsDataURL(file);
      });

  const onRemovePhoto = (idx: number, photoIdx: number) =>
    setUnits((prev) =>
      prev.map((u, i) =>
        i === idx ? { ...u, photos: u.photos.filter((_, p) => p !== photoIdx) } : u,
      ),
    );

  const goInspect = () => {
    if (!supplierId) {
      toast.error('กรุณาเลือกผู้ขาย (supplier)');
      return;
    }
    const badCost = lines.find((l) => !(Number(l.costPrice) > 0));
    if (badCost) {
      toast.error('กรุณาระบุราคาทุนมากกว่า 0 ให้ครบทุกรายการ');
      return;
    }
    setUnits(lines.flatMap(lineToUnits));
    setStep('inspect');
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
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
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
        <div>
          <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">
            ผู้ขาย (supplier) <span className="text-destructive">*</span>
          </label>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            className={fieldInput}
          >
            <option value="">เลือกผู้ขาย…</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        {lines.map((line, idx) => (
          <div key={idx} className="border border-border rounded-xl p-3 bg-card space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium leading-snug">รายการ #{idx + 1}</span>
              {lines.length > 1 && (
                <button
                  type="button"
                  onClick={() => setLines((p) => p.filter((_, i) => i !== idx))}
                  className="text-destructive p-2"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
            <select
              value={line.category}
              onChange={(e) => updateLine(idx, 'category', e.target.value)}
              className={fieldInput}
            >
              <option value="PHONE_NEW">มือถือใหม่</option>
              <option value="PHONE_USED">มือถือมือสอง</option>
              <option value="TABLET">แท็บเล็ต</option>
              <option value="ACCESSORY">อุปกรณ์เสริม</option>
            </select>
            <div className="grid grid-cols-2 gap-2">
              <input
                value={line.brand}
                onChange={(e) => updateLine(idx, 'brand', e.target.value)}
                placeholder="ยี่ห้อ"
                className={fieldInput}
              />
              <input
                value={line.model}
                onChange={(e) => updateLine(idx, 'model', e.target.value)}
                placeholder="รุ่น"
                className={fieldInput}
              />
              <input
                value={line.color}
                onChange={(e) => updateLine(idx, 'color', e.target.value)}
                placeholder="สี"
                className={fieldInput}
              />
              <input
                value={line.storage}
                onChange={(e) => updateLine(idx, 'storage', e.target.value)}
                placeholder="ความจุ"
                className={fieldInput}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">
                  จำนวน
                </label>
                <input
                  type="number"
                  min="1"
                  value={line.quantity}
                  onChange={(e) => updateLine(idx, 'quantity', e.target.value)}
                  className={fieldInput}
                />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">
                  ราคาทุน/ชิ้น <span className="text-destructive">*</span>
                </label>
                <input
                  type="number"
                  min="0"
                  value={line.costPrice}
                  onChange={(e) => updateLine(idx, 'costPrice', e.target.value)}
                  className={fieldInput}
                  placeholder="เช่น 30000"
                />
              </div>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setLines((p) => [...p, { ...emptyLine }])}
          className="w-full min-h-11 border-2 border-dashed border-input rounded-lg text-sm text-muted-foreground hover:border-primary/60 hover:bg-primary/5 flex items-center justify-center gap-1.5"
        >
          <Plus className="size-4" /> เพิ่มรายการ
        </button>
        <div>
          <label className="block text-xs text-muted-foreground mb-1 leading-snug">หมายเหตุ</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm leading-snug outline-hidden"
            placeholder="บันทึกเพิ่มเติม…"
          />
        </div>
      </div>
      <div className="shrink-0 border-t px-4 sm:px-6 py-3 flex gap-3 bg-background/95">
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 px-4 text-sm text-muted-foreground"
        >
          ยกเลิก
        </button>
        <button
          type="button"
          onClick={goInspect}
          className="flex-1 min-h-11 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90"
        >
          ถัดไป: ตรวจรับ
        </button>
      </div>
    </div>
  );

  const inspectBody = (
    <form onSubmit={submit} className="flex flex-col flex-1 overflow-hidden">
      <div className="shrink-0 px-4 sm:px-6 py-2 border-b">
        <button
          type="button"
          onClick={() => setStep('lines')}
          className="flex items-center gap-1 text-sm text-muted-foreground"
        >
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
      <div className="shrink-0 border-t px-4 sm:px-6 py-3 flex gap-3 bg-background/95">
        <button
          type="submit"
          disabled={directReceiveMutation.isPending}
          className="flex-1 min-h-11 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
        >
          {directReceiveMutation.isPending ? 'กำลังรับเข้า…' : 'ยืนยันรับเข้าตรง'}
        </button>
      </div>
    </form>
  );

  const body = step === 'lines' ? linesBody : inspectBody;
  const title = step === 'lines' ? 'รับเข้าตรง — เพิ่มรายการ' : 'รับเข้าตรง — ตรวจรับ';

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
      <div className="w-full max-w-3xl bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">
        <div className="sticky top-0 z-10 bg-background/95 border-b px-6 py-4 flex items-center justify-between shrink-0">
          <h2 className="text-lg font-semibold text-foreground leading-snug">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ปิด
          </button>
        </div>
        {body}
      </div>
    </div>
  );
}
