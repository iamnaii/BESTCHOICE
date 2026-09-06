import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import type { ItemForm, PoFormState, PurchaseMode } from '../types';
import { getExpectedDateError } from '../po-dates.util';
import { allItemsComplete } from '../po-catalog.util';

/**
 * One wizard, two ways in (owner 2026-09-06 "รวมกันได้เลยไหม"): the first step holds the supplier
 * AND the items for both modes; ordering ahead goes straight to สรุป + จ่ายเงิน, goods already in
 * hand get a ตรวจรับ step (IMEI / selling price / photos per unit) in between.
 */
export const PURCHASE_STEPS: Record<PurchaseMode, string[]> = {
  po: ['ผู้ขาย + รายการ', 'สรุป + จ่ายเงิน'],
  receive: ['ผู้ขาย + รายการ', 'ตรวจรับ', 'สรุป + จ่ายเงิน'],
};

const DRAFT_KEY = 'bestchoice-po-draft';
const DRAFT_TTL_MS = 24 * 60 * 60 * 1000; // 24h, matches the contract-draft TTL

interface PoDraft {
  step: number;
  /** absent on drafts saved before the modes existed → PO */
  mode?: PurchaseMode;
  form: PoFormState;
  items: ItemForm[];
  savedAt: string;
}

export interface UseCreatePoWizardOptions {
  isOpen: boolean;
  form: PoFormState;
  setForm: React.Dispatch<React.SetStateAction<PoFormState>>;
  items: ItemForm[];
  setItems: React.Dispatch<React.SetStateAction<ItemForm[]>>;
  selectedSupplier:
    | { id: string; name: string; hasVat: boolean; paymentMethods: { paymentMethod: string; creditTermDays?: number; isDefault: boolean }[] }
    | undefined;
}

export interface CreatePoWizardApi {
  step: number;
  mode: PurchaseMode;
  /** Switching modes returns to the first step (the toggle lives there anyway). */
  setMode: (mode: PurchaseMode) => void;
  /** Step labels for the current mode (PURCHASE_STEPS[mode]). */
  steps: string[];
  lastStep: number;
  /** receive mode, on ตรวจรับ */
  isInspect: boolean;
  /** on สรุป + จ่ายเงิน — the step that submits */
  isLast: boolean;
  goToStep: (s: number) => void;
  next: () => void;
  back: () => void;
  canNext: boolean;
  dueDatePreview: Date | null;
  creditTermDays: number | null;
  /** วันที่คาดรับสินค้าต้องไม่ก่อนวันที่สั่ง — null when valid or expectedDate empty */
  expectedDateError: string | null;
  draftRecovered: boolean;
  clearDraft: () => void;
}

export function useCreatePoWizard(opts: UseCreatePoWizardOptions): CreatePoWizardApi {
  const { isOpen, form, setForm, items, setItems, selectedSupplier } = opts;
  const [step, setStep] = useState(0);
  const [mode, setModeState] = useState<PurchaseMode>('po');
  const [draftRecovered, setDraftRecovered] = useState(false);
  const recoveredRef = useRef(false);

  const steps = PURCHASE_STEPS[mode];
  const lastStep = steps.length - 1;

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
      const restoredMode: PurchaseMode = draft.mode === 'receive' ? 'receive' : 'po';
      setModeState(restoredMode);
      // Units (IMEI / photos) are never saved, so a receive draft reopens on the first step;
      // a PO draft reopens where it was — old 3/4-step drafts land on the summary.
      setStep(restoredMode === 'receive' ? 0 : Math.min(Math.max(draft.step ?? 0, 0), PURCHASE_STEPS.po.length - 1));
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
      setModeState('po');
    }
  }, [isOpen]);

  // Auto-save: persist on every form/items/step/mode change while open (only if there is content)
  useEffect(() => {
    if (!isOpen) return;
    const hasContent = !!form.supplierId || items.some((i) => i.category || i.unitPrice);
    if (!hasContent) return;
    const draft: PoDraft = { step, mode, form, items, savedAt: new Date().toISOString() };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  }, [isOpen, step, mode, form, items]);

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

  // The first step gate: a RESOLVED supplier (a recovered draft can name one that no longer
  // exists), a sane expected date, and every row complete. Later steps validate in the modal
  // (ตรวจรับ) or submit (สรุป + จ่ายเงิน).
  const expectedDateError = getExpectedDateError(form.orderDate, form.expectedDate);
  const canNext = step === 0 ? !!selectedSupplier && !expectedDateError && allItemsComplete(items) : true;

  const goToStep = useCallback(
    (s: number) => {
      if (s >= 0 && s <= lastStep) setStep(s);
    },
    [lastStep],
  );
  const next = useCallback(() => setStep((s) => Math.min(s + 1, lastStep)), [lastStep]);
  const back = useCallback(() => setStep((s) => Math.max(s - 1, 0)), []);
  const setMode = useCallback((m: PurchaseMode) => {
    setModeState(m);
    setStep(0);
  }, []);

  // dueDatePreview is exported as a Date so each panel formats it (formatDateShort) itself.
  return {
    step,
    mode,
    setMode,
    steps,
    lastStep,
    isInspect: mode === 'receive' && step === 1,
    isLast: step === lastStep,
    goToStep,
    next,
    back,
    canNext,
    dueDatePreview,
    creditTermDays,
    expectedDateError,
    draftRecovered,
    clearDraft,
  };
}
