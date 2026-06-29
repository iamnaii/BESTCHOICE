import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ItemForm } from '../types';

export const WIZARD_STEPS = ['เลือกผู้ขาย', 'เพิ่มรายการ', 'ส่วนลด/VAT', 'ทบทวน+บันทึก'];
const LAST_STEP = WIZARD_STEPS.length - 1;

const DRAFT_KEY = 'bestchoice-po-draft';
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24h, matches the contract-draft TTL

type WizardForm = {
  supplierId: string; orderDate: string; expectedDate: string; discount: string;
  discountAfterVat: string; notes: string; paymentStatus: string; paymentMethod: string;
  paidAmount: string; paymentNotes: string;
};

interface PoDraft {
  step: number;
  form: WizardForm;
  items: ItemForm[];
  savedAt: string;
}

export interface UseCreatePoWizardOptions {
  isOpen: boolean;
  form: WizardForm;
  setForm: React.Dispatch<React.SetStateAction<WizardForm>>;
  items: ItemForm[];
  setItems: React.Dispatch<React.SetStateAction<ItemForm[]>>;
  selectedSupplier:
    | { id: string; name: string; hasVat: boolean; paymentMethods: { paymentMethod: string; creditTermDays?: number; isDefault: boolean }[] }
    | undefined;
}

export interface CreatePoWizardApi {
  step: number;
  goToStep: (s: number) => void;
  next: () => void;
  back: () => void;
  canNext: boolean;
  dueDatePreview: Date | null;
  creditTermDays: number | null;
  draftRecovered: boolean;
  clearDraft: () => void;
}

export function useCreatePoWizard(opts: UseCreatePoWizardOptions): CreatePoWizardApi {
  const { isOpen, form, setForm, items, setItems, selectedSupplier } = opts;
  const [step, setStep] = useState(0);
  const [draftRecovered, setDraftRecovered] = useState(false);
  const recoveredRef = useRef(false);

  const clearDraft = useCallback(() => {
    localStorage.removeItem(DRAFT_KEY);
  }, []);

  // Restore draft once per open
  useEffect(() => {
    if (!isOpen || recoveredRef.current) return;
    recoveredRef.current = true;
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    try {
      const draft = JSON.parse(raw) as PoDraft;
      if (new Date().getTime() - new Date(draft.savedAt).getTime() > DRAFT_TTL_MS) {
        localStorage.removeItem(DRAFT_KEY);
        return;
      }
      setForm(draft.form);
      setItems(draft.items);
      setStep(draft.step);
      setDraftRecovered(true);
      toast('พบใบสั่งซื้อร่างที่บันทึกไว้ — กู้คืนแล้ว', {
        description: `บันทึกเมื่อ ${new Date(draft.savedAt).toLocaleString('th-TH')}`,
        duration: 5000,
      });
    } catch {
      localStorage.removeItem(DRAFT_KEY);
    }
  }, [isOpen, setForm, setItems]);

  // Reset recovery latch when the modal closes so reopening recovers again
  useEffect(() => {
    if (!isOpen) {
      recoveredRef.current = false;
      setDraftRecovered(false);
      setStep(0);
    }
  }, [isOpen]);

  // Auto-save: persist on every form/items/step change while open (only if there is content)
  useEffect(() => {
    if (!isOpen) return;
    const hasContent = !!form.supplierId || items.some((i) => i.category || i.unitPrice);
    if (!hasContent) return;
    const draft: PoDraft = { step, form, items, savedAt: new Date().toISOString() };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [isOpen, step, form, items]);

  // Credit-term-driven due-date preview (mirrors po-lifecycle.service.create():69-77)
  const selectedPm = form.paymentMethod
    ? selectedSupplier?.paymentMethods.find((pm) => pm.paymentMethod === form.paymentMethod)
    : selectedSupplier?.paymentMethods.find((pm) => pm.isDefault) ?? selectedSupplier?.paymentMethods[0];
  const creditTermDays = selectedPm?.creditTermDays ?? null;
  let dueDatePreview: Date | null = null;
  if (creditTermDays && form.orderDate) {
    const dd = new Date(form.orderDate);
    if (!Number.isNaN(dd.getTime())) {
      dd.setDate(dd.getDate() + creditTermDays);
      dueDatePreview = dd;
    }
  }

  // Per-step advance gate
  const itemsValid = items.length > 0 && items.every(
    (i) => i.category && Number(i.quantity) > 0 && Number(i.unitPrice) > 0,
  );
  const canNext =
    step === 0 ? !!form.supplierId :
    step === 1 ? itemsValid :
    true; // steps 2 & 3 are always advanceable (3 = submit handled by the form)

  const goToStep = useCallback((s: number) => {
    if (s >= 0 && s <= LAST_STEP) setStep(s);
  }, []);
  const next = useCallback(() => setStep((s) => Math.min(s + 1, LAST_STEP)), []);
  const back = useCallback(() => setStep((s) => Math.max(s - 1, 0)), []);

  // dueDatePreview is exported as a Date so each panel formats it (formatDateShort) itself.
  return { step, goToStep, next, back, canNext, dueDatePreview, creditTermDays, draftRecovered, clearDraft };
}
