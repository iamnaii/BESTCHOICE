import { useState } from 'react';
import { UseMutationResult } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ChevronLeft, ClipboardCheck, FileText, Info, Package, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ContactPickResult } from '@/components/contacts/ContactCombobox';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import type { ItemForm, PoFormState, PurchaseMode, ReceivingUnitForm, SupplierOption } from '../types';
import type { AccessorySku, CatalogEntry, PhoneMode } from '../po-catalog.util';
import { allItemsComplete } from '../po-catalog.util';
import type { PoTotals } from '../poTotals';
import type { CreatePoWizardApi } from '../hooks/useCreatePoWizard';
import type { DirectReceiveInput } from '../hooks/usePurchaseOrdersData';
import { buildDirectReceivePayload, lineToUnits } from '../direct-receive.util';
import { receivingBlockers } from '../receiving-flow.util';
import { StepSupplier } from './wizard/StepSupplier';
import { StepItems } from './wizard/StepItems';
import { StepSummary } from './wizard/StepSummary';
import { WizardStepper, type WizardStep } from './wizard/WizardStepper';
import { paidAmountError, isPaidStatus } from './wizard/PaymentSection';
import { ReceivingFlow } from './ReceivingFlow';

export interface PurchaseModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: PoFormState;
  setForm: React.Dispatch<React.SetStateAction<PoFormState>>;
  items: ItemForm[];
  removeItem: (idx: number) => void;
  duplicateItem: (idx: number) => void;
  updateItem: (idx: number, field: string, value: string) => void;
  toggleModel: (idx: number, modelName: string) => void;
  addCatalogItem: (entry: CatalogEntry, phoneMode: PhoneMode) => void;
  addAccessoryItem: (accessoryType: string) => void;
  addExistingAccessoryItem: (sku: AccessorySku) => void;
  searchAccessorySkus: (search: string) => Promise<AccessorySku[]>;
  suppliers: SupplierOption[];
  suppliersLoading: boolean;
  suppliersError: boolean;
  selectedSupplier: SupplierOption | undefined;
  onSupplierSelect: (result: ContactPickResult) => Promise<void> | void;
  supplierHasVat: boolean;
  subtotal: number;
  createMutation: UseMutationResult<unknown, unknown, Record<string, unknown>, unknown>;
  /** PO mode submit (usePOForm) — validates, then POST /purchase-orders */
  handleCreate: (e: React.FormEvent) => void;
  attachmentUrl: string;
  setAttachmentUrl: (value: string) => void;
  formAttachments: string[];
  setFormAttachments: React.Dispatch<React.SetStateAction<string[]>>;
  wizard: CreatePoWizardApi;
  totals: PoTotals;
  /** receive mode submit — POST /purchase-orders/direct-receive with the inspected units */
  directReceiveMutation: UseMutationResult<unknown, unknown, DirectReceiveInput, unknown>;
}

const STEP_ICONS: Record<string, LucideIcon> = { 'ผู้ขาย + รายการ': Package, 'ตรวจรับ': ClipboardCheck, 'สรุป + จ่ายเงิน': FileText };
const RECEIVE_LABELS = {
  title: 'รายการที่รับเข้า',
  hint: 'ค้นหารุ่นแล้วกดเพิ่ม — สภาพ / ความจุ / สี / จำนวน / ราคาทุน เลือกในตาราง · อุปกรณ์เสริมค้นจากสินค้าเดิมหรือสร้างรายการใหม่',
  price: 'ราคาทุน/ชิ้น',
  total: 'รวมทุน',
  footerTotal: 'ต้นทุนรวม',
};
const PO_LABELS = { title: 'รายการที่สั่งซื้อ' };

const inputClass =
  'w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';
const primaryBtn =
  'px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm whitespace-nowrap';
const outlineBtn = 'px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors';

const todayIso = () => new Date().toISOString().split('T')[0];

/**
 * ซื้อสินค้า — one wizard for both ways in (owner 2026-09-06 "รวมกันได้เลยไหม"). Step 1 holds the
 * supplier, the mode toggle and the items table; PO mode goes straight to สรุป + จ่ายเงิน and
 * creates the PO, receive mode inspects every unit (IMEI / selling price / photos) first and then
 * books the goods today through direct-receive. Replaces CreatePOModal + DirectReceiveModal.
 * No submit-type button anywhere — ถัดไป / สร้าง PO / ยืนยัน are plain buttons (a real click on
 * a button that flips to type=submit mid-dispatch used to submit the form, 2026-09-06).
 */
export function PurchaseModal(props: PurchaseModalProps) {
  const {
    isOpen,
    onClose,
    form,
    setForm,
    items,
    removeItem,
    duplicateItem,
    updateItem,
    toggleModel,
    addCatalogItem,
    addAccessoryItem,
    addExistingAccessoryItem,
    searchAccessorySkus,
    suppliersLoading,
    suppliersError,
    selectedSupplier,
    onSupplierSelect,
    supplierHasVat,
    subtotal,
    createMutation,
    handleCreate,
    attachmentUrl,
    setAttachmentUrl,
    formAttachments,
    setFormAttachments,
    wizard,
    totals,
    directReceiveMutation,
  } = props;
  const isMobile = useIsMobile();
  const [units, setUnits] = useState<ReceivingUnitForm[]>([]);

  if (!isOpen) return null;

  const { step, mode, setMode, steps, isInspect, isLast, goToStep, next, back, canNext, expectedDateError } = wizard;
  const receive = mode === 'receive';
  const pieces = items.reduce((n, i) => n + (Number(i.quantity) || 0), 0);
  const complete = allItemsComplete(items);
  const stepper: WizardStep[] = steps.map((label) => ({ label, icon: STEP_ICONS[label] ?? Package }));

  const onModeChange = (m: PurchaseMode) => {
    if (m === mode) return;
    setMode(m);
    setUnits([]);
    // goods in hand are booked today — the PO dates do not apply
    if (m === 'receive') setForm({ ...form, orderDate: todayIso(), expectedDate: '' });
  };

  // ---- step 0: lock reasons + primary label ----
  const firstHint = !selectedSupplier
    ? form.supplierId
      ? 'ไม่พบผู้จัดจำหน่ายที่บันทึกไว้ในร่าง — กรุณาเลือกผู้ขายใหม่'
      : 'เลือกผู้ขายก่อน'
    : expectedDateError
      ? expectedDateError
      : items.length === 0
        ? 'เพิ่มอย่างน้อย 1 รายการ'
        : !complete
          ? receive
            ? 'กรอกจำนวนและราคาทุนให้ครบทุกรายการ'
            : 'กรอกจำนวนและราคาให้ครบทุกรายการ'
          : receive
            ? 'ขั้นถัดไปตรวจรับทีละเครื่อง: IMEI · ซีเรียล · ผล · ราคาขาย'
            : 'ขั้นถัดไป ส่วนลด/VAT · จ่ายเงิน · หมายเหตุ แล้วสร้าง PO';
  const firstLabel = receive ? (pieces > 0 ? `ถัดไป: ตรวจรับ ${pieces} ชิ้น` : 'ถัดไป: ตรวจรับ') : 'ถัดไป: สรุป + จ่ายเงิน';

  const goFromFirst = () => {
    if (!canNext) return;
    if (receive) setUnits(items.flatMap(lineToUnits));
    next();
  };

  // ---- receive: ตรวจรับ ----
  /** ตรวจรับ → สรุป: every device must be complete (the same rules the device screens enforce). */
  const goSummary = () => {
    const blocker = receivingBlockers(units)[0];
    if (blocker) {
      toast.error(`ชิ้นที่ ${blocker.idx + 1}: ${blocker.message}`);
      return;
    }
    // the summary's payment block starts from the supplier's default method (a draft may lack it)
    if (!form.paymentMethod) {
      const defaultPm = selectedSupplier?.paymentMethods.find((pm) => pm.isDefault) ?? selectedSupplier?.paymentMethods[0];
      if (defaultPm) setForm({ ...form, paymentMethod: defaultPm.paymentMethod });
    }
    next();
  };

  const submitReceive = () => {
    if (isPaidStatus(form.paymentStatus)) {
      const err = paidAmountError(form, totals.netAmount);
      if (err) {
        toast.error(err);
        return;
      }
    }
    directReceiveMutation.mutate(buildDirectReceivePayload({ form, units, attachments: formAttachments, today: todayIso() }));
  };

  const passed = units.filter((u) => u.status === 'PASS').length;
  const rejected = units.length - passed;
  const pending = createMutation.isPending || directReceiveMutation.isPending;

  const title = isInspect ? 'ซื้อสินค้า — ตรวจรับ' : isLast ? 'ซื้อสินค้า — สรุป + จ่ายเงิน' : 'ซื้อสินค้า';
  const width = isInspect ? 'max-w-3xl' : isLast ? 'max-w-4xl' : 'max-w-7xl';

  const panel = isInspect ? (
    <div className="-mx-4 sm:-mx-6">
      <button type="button" onClick={() => goToStep(0)} className="ml-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground sm:ml-6">
        <ChevronLeft className="size-4" /> กลับไปแก้รายการ
      </button>
      {/* one device per screen — the wizard's own footer carries ถัดไป / ย้อนกลับ */}
      <ReceivingFlow units={units} setUnits={setUnits} mode="direct" />
    </div>
  ) : isLast ? (
    <StepSummary
      form={form}
      setForm={setForm}
      items={items}
      selectedSupplier={selectedSupplier}
      supplierHasVat={supplierHasVat}
      totals={totals}
      dueDatePreview={wizard.dueDatePreview}
      attachmentUrl={attachmentUrl}
      setAttachmentUrl={setAttachmentUrl}
      formAttachments={formAttachments}
      setFormAttachments={setFormAttachments}
      onEditItems={() => goToStep(0)}
      receive={receive ? { passed, rejected } : undefined}
    />
  ) : (
    <div className="space-y-5">
      <StepSupplier
        form={form}
        setForm={setForm}
        mode={mode}
        onModeChange={onModeChange}
        suppliersLoading={suppliersLoading}
        suppliersError={suppliersError}
        selectedSupplier={selectedSupplier}
        onSupplierSelect={onSupplierSelect}
        supplierHasVat={supplierHasVat}
        creditTermDays={wizard.creditTermDays}
        dueDatePreview={wizard.dueDatePreview}
        expectedDateError={expectedDateError}
        inputClass={inputClass}
      />
      <StepItems
        items={items}
        updateItem={updateItem}
        toggleModel={toggleModel}
        removeItem={removeItem}
        duplicateItem={duplicateItem}
        addCatalogItem={addCatalogItem}
        addAccessoryItem={addAccessoryItem}
        addExistingAccessoryItem={addExistingAccessoryItem}
        searchAccessorySkus={searchAccessorySkus}
        subtotal={subtotal}
        labels={receive ? RECEIVE_LABELS : PO_LABELS}
      />
    </div>
  );

  const footer = (
    <div className="sticky bottom-0 shrink-0 border-t bg-background/95 px-4 py-4 backdrop-blur-xs sm:px-6 flex items-center justify-between gap-3">
      <button type="button" onClick={() => (step === 0 ? onClose() : back())} className={outlineBtn}>
        {step === 0 ? 'ยกเลิก' : 'ย้อนกลับ'}
      </button>
      <div className="flex items-center gap-4">
        {step === 0 && (
          <span className="hidden items-center gap-1.5 text-xs leading-snug text-muted-foreground sm:inline-flex">
            <Info className="size-3.5 shrink-0" />
            {firstHint}
          </span>
        )}
        {step === 0 && (
          <button key="first" type="button" onClick={goFromFirst} disabled={!canNext} className={primaryBtn}>
            {firstLabel}
          </button>
        )}
        {isInspect && (
          <button key="inspect" type="button" onClick={goSummary} className={primaryBtn}>
            ถัดไป: สรุป + จ่ายเงิน
          </button>
        )}
        {isLast && !receive && (
          <button key="create" type="button" onClick={handleCreate} disabled={pending} className={primaryBtn}>
            {createMutation.isPending ? 'กำลังสร้าง...' : 'สร้าง PO'}
          </button>
        )}
        {isLast && receive && (
          <button key="receive" type="button" onClick={submitReceive} disabled={pending} className={primaryBtn}>
            {directReceiveMutation.isPending ? 'กำลังรับเข้า…' : `ยืนยันรับเข้าตรง ${units.length} ชิ้น`}
          </button>
        )}
      </div>
    </div>
  );

  // The form never submits itself (no submit button; Enter in an input is swallowed) — the
  // footer buttons call their handlers directly.
  const body = (
    <form
      onSubmit={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault();
      }}
      className="flex flex-1 flex-col overflow-hidden"
    >
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">{panel}</div>
      {footer}
    </form>
  );
  const stepperEl = <WizardStepper steps={stepper} current={step} onStepClick={goToStep} />;

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
            <div className="pt-2">{stepperEl}</div>
          </DrawerHeader>
          {body}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8" role="dialog" aria-modal="true" aria-label="ซื้อสินค้า">
      {/* 7xl while the nine-column items table is on screen; the per-unit cards and the summary keep narrower frames */}
      <div className={cn('w-full bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]', width)}>
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between shrink-0">
          <button type="button" onClick={onClose} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <ChevronLeft className="size-4" />
            ปิด
          </button>
          <h2 className="text-lg font-semibold text-foreground leading-snug">{title}</h2>
          <div className="w-16" />
        </div>
        <div className="px-6 pt-4 shrink-0">{stepperEl}</div>
        {body}
      </div>
    </div>
  );
}
