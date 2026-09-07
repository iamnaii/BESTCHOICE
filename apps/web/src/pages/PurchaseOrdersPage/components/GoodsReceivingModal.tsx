import { useEffect, useRef, useState } from 'react';
import { UseMutationResult } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { PurchaseOrder, ReceivingUnitForm } from '../types';
import { ReceivingFlow } from './ReceivingFlow';

export interface GoodsReceivingModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPO: PurchaseOrder | null;
  receivingUnits: ReceivingUnitForm[];
  setReceivingUnits: React.Dispatch<React.SetStateAction<ReceivingUnitForm[]>>;
  receivingNotes: string;
  setReceivingNotes: (value: string) => void;
  goodsReceivingMutation: UseMutationResult<
    unknown,
    unknown,
    { poId: string; items: ReceivingUnitForm[]; notes: string },
    unknown
  >;
  /** ยืนยันรับสินค้า — validates through the shared blockers, then posts */
  handleGoodsReceiving: (e?: React.FormEvent) => void;
  /** asked before discarding typed data — the page routes it through its ConfirmDialog */
  confirmClose?: (proceed: () => void) => void;
}

/** Anything changed since the modal opened (an IMEI, a result, a price…) — closing would throw it away. */
export function receivingIsDirty(units: ReceivingUnitForm[], baseline: string | null): boolean {
  return baseline !== null && JSON.stringify(units) !== baseline;
}

/**
 * รับสินค้า — one device per screen (owner-approved mockup 2026-09-07). The modal is only the
 * frame (PO number, supplier, X / Esc); every screen lives in ReceivingFlow so the ซื้อสินค้า
 * wizard's ตรวจรับ step can reuse it.
 */
export function GoodsReceivingModal(props: GoodsReceivingModalProps) {
  const {
    isOpen,
    onClose,
    selectedPO,
    receivingUnits,
    setReceivingUnits,
    receivingNotes,
    setReceivingNotes,
    goodsReceivingMutation,
    handleGoodsReceiving,
    confirmClose,
  } = props;
  const isMobile = useIsMobile();
  const overlayRef = useRef<HTMLDivElement>(null);
  // device screens sit in a 680px frame; the summary table (the ordering columns + IMEI/serial/prices) needs ~1100
  const [wide, setWide] = useState(false);
  // the units as seeded when the modal opened — the dirty check compares against this
  const baselineRef = useRef<string | null>(null);
  if (isOpen && baselineRef.current === null) baselineRef.current = JSON.stringify(receivingUnits);
  useEffect(() => {
    if (!isOpen) {
      baselineRef.current = null;
      setWide(false);
    }
  }, [isOpen]);

  const requestClose = () => {
    if (confirmClose && receivingIsDirty(receivingUnits, baselineRef.current)) confirmClose(onClose);
    else onClose();
  };

  // Esc closes the topmost dialog only (a confirm dialog on top keeps this one open)
  useEffect(() => {
    if (!isOpen || isMobile) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== overlayRef.current) return;
      e.preventDefault();
      requestClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, isMobile, receivingUnits, confirmClose, onClose]);

  if (!isOpen || !selectedPO) return null;

  const total = receivingUnits.length;
  const flow = (
    <ReceivingFlow
      units={receivingUnits}
      setUnits={setReceivingUnits}
      mode="po"
      notes={receivingNotes}
      setNotes={setReceivingNotes}
      onConfirm={() => handleGoodsReceiving()}
      confirming={goodsReceivingMutation.isPending}
      confirmLabel={`ยืนยันรับสินค้า ${total} ชิ้น`}
      onCancel={requestClose}
      onViewChange={(v) => setWide(v === 'summary')}
    />
  );

  if (isMobile) {
    return (
      <Drawer
        open={isOpen}
        onOpenChange={(o) => {
          if (!o) requestClose();
        }}
      >
        <DrawerContent className="h-[92dvh]">
          <DrawerHeader className="text-left">
            <DrawerTitle className="leading-snug">
              รับสินค้า <span className="font-mono text-sm text-muted-foreground">{selectedPO.poNumber}</span>
            </DrawerTitle>
            <div className="text-[13px] text-muted-foreground">
              {selectedPO.supplier.name} · {total} ชิ้น
            </div>
          </DrawerHeader>
          <div className="flex-1 overflow-y-auto pb-4">{flow}</div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-8 pb-8 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="รับสินค้า"
    >
      <div
        className={cn(
          'flex max-h-[calc(100vh-4rem)] w-full flex-col overflow-hidden rounded-[14px] bg-background shadow-2xl transition-[max-width]',
          wide ? 'max-w-[1160px]' : 'max-w-[680px]',
        )}
      >
        <div className="flex shrink-0 items-start gap-3 px-6 pt-[18px]">
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2.5">
              <h2 className="text-lg font-semibold leading-snug">รับสินค้า</h2>
              <span className="font-mono text-[13px] font-semibold text-muted-foreground">{selectedPO.poNumber}</span>
            </div>
            <div className="mt-0.5 text-[13px] text-muted-foreground">
              {selectedPO.supplier.name} · {total} ชิ้น
            </div>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="ปิด"
            title="ปิด (Esc)"
            className="grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="size-[18px]" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">{flow}</div>
      </div>
    </div>
  );
}
