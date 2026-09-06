import { UseMutationResult } from '@tanstack/react-query';
import { Users, Package, FileText } from 'lucide-react';
import { ItemForm } from '../types';
import type { ContactPickResult } from '@/components/contacts/ContactCombobox';
import { WIZARD_STEPS } from '../hooks/useCreatePoWizard';
import type { AccessorySku, CatalogEntry, PhoneMode } from '../po-catalog.util';
import { StepSupplier } from './wizard/StepSupplier';
import { StepItems } from './wizard/StepItems';
import { StepSummary } from './wizard/StepSummary';
import { WizardStepper, type WizardStep } from './wizard/WizardStepper';

export interface CreatePOModalProps {
  isOpen: boolean;
  onClose: () => void;
  form: {
    supplierId: string;
    orderDate: string;
    expectedDate: string;
    notes: string;
    discount: string;
    discountAfterVat: string;
    paymentStatus: string;
    paymentMethod: string;
    paidAmount: string;
    paymentNotes: string;
  };
  setForm: React.Dispatch<React.SetStateAction<CreatePOModalProps['form']>>;
  items: ItemForm[];
  removeItem: (idx: number) => void;
  duplicateItem: (idx: number) => void;
  updateItem: (idx: number, field: string, value: string) => void;
  toggleModel: (idx: number, modelName: string) => void;
  addCatalogItem: (entry: CatalogEntry, phoneMode: PhoneMode) => void;
  addAccessoryItem: (accessoryType: string) => void;
  addExistingAccessoryItem: (sku: AccessorySku) => void;
  searchAccessorySkus: (search: string) => Promise<AccessorySku[]>;
  suppliers: {
    id: string;
    name: string;
    contactName: string | null;
    hasVat: boolean;
    paymentMethods: {
      paymentMethod: string;
      bankName?: string;
      bankAccountName?: string;
      bankAccountNumber?: string;
      creditTermDays?: number;
      isDefault: boolean;
    }[];
  }[];
  suppliersLoading: boolean;
  suppliersError: boolean;
  selectedSupplier: CreatePOModalProps['suppliers'][number] | undefined;
  onSupplierSelect: (result: ContactPickResult) => Promise<void>;
  supplierHasVat: boolean;
  subtotal: number;
  createMutation: UseMutationResult<unknown, unknown, Record<string, unknown>, unknown>;
  handleCreate: (e: React.FormEvent) => void;
  attachmentUrl: string;
  setAttachmentUrl: (value: string) => void;
  formAttachments: string[];
  setFormAttachments: React.Dispatch<React.SetStateAction<string[]>>;
  wizard: import('../hooks/useCreatePoWizard').CreatePoWizardApi;
  totals: import('../poTotals').PoTotals;
}

// One icon per wizard step: เลือกผู้ขาย → เพิ่มรายการ → สรุป + จ่ายเงิน
const STEP_ICONS = [Users, Package, FileText];
const STEPS: WizardStep[] = WIZARD_STEPS.map((label, i) => ({ label, icon: STEP_ICONS[i] ?? Package }));

export function CreatePOModal({
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
}: CreatePOModalProps) {
  if (!isOpen) return null;

  const inputClass =
    'w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

  const { step, goToStep, next, back, canNext } = wizard;
  const isLast = step === WIZARD_STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8"
      role="dialog"
      aria-modal="true"
      aria-label="สร้างใบสั่งซื้อ"
    >
      {/* 7xl so the items table's nine columns breathe at 40px controls (owner: "มันแน่นไปป่าว") */}
      <div className="w-full max-w-7xl bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
            ปิด
          </button>
          <h2 className="text-lg font-semibold text-foreground leading-snug">สร้างใบสั่งซื้อ</h2>
          <div className="w-16" />
        </div>

        {/* Stepper */}
        <div className="px-6 pt-4 shrink-0">
          <WizardStepper steps={STEPS} current={step} onStepClick={goToStep} />
        </div>

        {/* Active step panel. The wizard never renders a submit-type button: the footer's
            ถัดไป / สร้าง PO share one position, and a real click on ถัดไป used to flip that same
            <button> to type=submit mid-dispatch (React flushes the step change in a microtask
            between listeners), so the browser's activation behaviour submitted the form and
            created the PO instead of showing the summary (2026-09-06). สร้าง PO calls
            handleCreate itself; onSubmit + the Enter guard stay only as belt-and-braces. */}
        <form
          onSubmit={handleCreate}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') e.preventDefault();
          }}
          className="flex-1 overflow-y-auto"
        >
          <div className="p-6">
            {step === 0 && (
              <StepSupplier
                form={form}
                setForm={setForm}
                suppliersLoading={suppliersLoading}
                suppliersError={suppliersError}
                selectedSupplier={selectedSupplier}
                onSupplierSelect={onSupplierSelect}
                supplierHasVat={supplierHasVat}
                creditTermDays={wizard.creditTermDays}
                dueDatePreview={wizard.dueDatePreview}
                expectedDateError={wizard.expectedDateError}
                inputClass={inputClass}
              />
            )}
            {step === 1 && (
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
              />
            )}
            {step === 2 && (
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
                onEditItems={() => goToStep(1)}
              />
            )}
          </div>

          {/* Footer */}
          <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 flex justify-between gap-3 shrink-0">
            <button
              type="button"
              onClick={() => (step === 0 ? onClose() : back())}
              className="px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors"
            >
              {step === 0 ? 'ยกเลิก' : 'ย้อนกลับ'}
            </button>
            {isLast ? (
              <button
                key="create"
                type="button"
                onClick={handleCreate}
                disabled={createMutation.isPending}
                className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm"
              >
                {createMutation.isPending ? 'กำลังสร้าง...' : 'สร้าง PO'}
              </button>
            ) : (
              <button
                key="next"
                type="button"
                onClick={() => canNext && next()}
                disabled={!canNext}
                className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm"
              >
                ถัดไป
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
