import { UseMutationResult } from '@tanstack/react-query';
import { Check, Users, Package, Calculator, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ItemForm } from '../types';
import type { ContactPickResult } from '@/components/contacts/ContactCombobox';
import { WIZARD_STEPS } from '../hooks/useCreatePoWizard';
import { StepSupplier } from './wizard/StepSupplier';
import { StepItems } from './wizard/StepItems';
import { StepDiscountVat } from './wizard/StepDiscountVat';
import { StepReview } from './wizard/StepReview';

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
  setItems: React.Dispatch<React.SetStateAction<ItemForm[]>>;
  addItem: () => void;
  removeItem: (idx: number) => void;
  updateItem: (idx: number, field: string, value: string) => void;
  toggleModel: (idx: number, modelName: string) => void;
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
  discountNum: number;
  subtotalAfterDiscount: number;
  vatAmount: number;
  totalWithVat: number;
  discountAfterVatNum: number;
  netAmount: number;
  createMutation: UseMutationResult<unknown, unknown, Record<string, unknown>, unknown>;
  handleCreate: (e: React.FormEvent) => void;
  attachmentUrl: string;
  setAttachmentUrl: (value: string) => void;
  formAttachments: string[];
  setFormAttachments: React.Dispatch<React.SetStateAction<string[]>>;
  wizard: import('../hooks/useCreatePoWizard').CreatePoWizardApi;
  totals: import('../poTotals').PoTotals;
}

export function CreatePOModal({
  isOpen,
  onClose,
  form,
  setForm,
  items,
  setItems,
  addItem,
  removeItem,
  updateItem,
  toggleModel,
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

  const selectClass =
    'w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';
  const inputClass = selectClass;

  const stepIcons = [Users, Package, Calculator, FileText];
  const { step, goToStep, next, back, canNext } = wizard;
  const isLast = step === WIZARD_STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8"
      role="dialog"
      aria-modal="true"
      aria-label="สร้างใบสั่งซื้อ"
    >
      <div className="w-full max-w-3xl bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">
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
          <div className="flex items-center">
            {WIZARD_STEPS.map((label, i) => {
              const completed = i < step;
              const current = i === step;
              const clickable = i < step;
              const Icon = stepIcons[i] || Package;
              return (
                <div key={label} className="flex items-center flex-1 last:flex-none">
                  <button
                    type="button"
                    disabled={!clickable}
                    onClick={() => clickable && goToStep(i)}
                    className={cn(
                      'flex items-center gap-2 group',
                      clickable ? 'cursor-pointer' : 'cursor-default',
                    )}
                  >
                    <div
                      className={cn(
                        'size-8 rounded-lg flex items-center justify-center shrink-0 transition-all',
                        completed && 'bg-primary text-primary-foreground',
                        current && 'bg-primary text-primary-foreground ring-4 ring-primary/20',
                        !completed && !current && 'bg-muted text-muted-foreground',
                      )}
                    >
                      {completed ? (
                        <Check className="size-4" strokeWidth={2.5} />
                      ) : (
                        <Icon className="size-4" />
                      )}
                    </div>
                    <div
                      className={cn(
                        'text-sm font-medium leading-snug hidden sm:block',
                        current ? 'text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      {label}
                    </div>
                  </button>
                  {i < WIZARD_STEPS.length - 1 && (
                    <div className="flex-1 mx-3 h-0.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className={cn(
                          'h-full rounded-full transition-all',
                          i < step ? 'bg-primary w-full' : 'w-0',
                        )}
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Active step panel */}
        <form onSubmit={handleCreate} className="flex-1 overflow-y-auto">
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
                inputClass={inputClass}
              />
            )}
            {step === 1 && (
              <StepItems
                items={items}
                setItems={setItems}
                addItem={addItem}
                removeItem={removeItem}
                updateItem={updateItem}
                toggleModel={toggleModel}
                subtotal={subtotal}
                selectClass={selectClass}
                inputClass={inputClass}
              />
            )}
            {step === 2 && (
              <StepDiscountVat
                form={form}
                setForm={setForm}
                supplierHasVat={supplierHasVat}
                totals={totals}
              />
            )}
            {step === 3 && (
              <StepReview
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
                selectClass={selectClass}
                inputClass={inputClass}
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
                type="submit"
                disabled={createMutation.isPending}
                className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm"
              >
                {createMutation.isPending ? 'กำลังสร้าง...' : 'สร้าง PO'}
              </button>
            ) : (
              <button
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
