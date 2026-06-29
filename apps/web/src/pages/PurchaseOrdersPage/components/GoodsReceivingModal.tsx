import { UseMutationResult } from '@tanstack/react-query';
import { PurchaseOrder, ReceivingUnitForm } from '../types';
import { ReceivingUnitCard } from './ReceivingUnitCard';
import { useReceivingDuplicates } from './useReceivingDuplicates';
import { useIsMobile } from '@/hooks/useIsMobile';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { ChevronLeft } from 'lucide-react';

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
  updateReceivingUnit: (idx: number, field: string, value: string) => void;
  updateChecklist: (
    unitIdx: number,
    checkIdx: number,
    field: 'passed' | 'note',
    value: boolean | string,
  ) => void;
  handleGoodsReceiving: (e: React.FormEvent) => void;
}

const MAX_PHOTOS_PER_UNIT = 6;

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
    updateReceivingUnit,
    updateChecklist,
    handleGoodsReceiving,
  } = props;
  const isMobile = useIsMobile();
  const dupIndices = useReceivingDuplicates(receivingUnits);

  const onAddPhotos = (idx: number, files: FileList) => {
    Array.from(files)
      .slice(0, MAX_PHOTOS_PER_UNIT)
      .forEach((file) => {
        const reader = new FileReader();
        reader.onload = () =>
          setReceivingUnits((prev) => {
            const next = [...prev];
            const cur = next[idx];
            if (cur.photos.length >= MAX_PHOTOS_PER_UNIT) return prev;
            next[idx] = { ...cur, photos: [...cur.photos, reader.result as string] };
            return next;
          });
        reader.readAsDataURL(file);
      });
  };
  const onRemovePhoto = (idx: number, photoIdx: number) =>
    setReceivingUnits((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], photos: next[idx].photos.filter((_, i) => i !== photoIdx) };
      return next;
    });

  const passCount = receivingUnits.filter((u) => u.status === 'PASS').length;
  const rejectCount = receivingUnits.filter((u) => u.status === 'REJECT').length;

  if (!isOpen) return null;

  const body = (
    <form onSubmit={handleGoodsReceiving} className="flex flex-col flex-1 overflow-hidden">
      {/* Sticky progress strip */}
      <div className="shrink-0 px-4 sm:px-6 py-3 border-b bg-background/95 backdrop-blur-xs">
        <div className="flex items-center justify-between text-sm leading-snug">
          <span className="text-muted-foreground">ตรวจรับ {receivingUnits.length} ชิ้น</span>
          <span className="flex gap-3">
            <span className="text-success">ผ่าน {passCount}</span>
            <span className="text-destructive">ไม่ผ่าน {rejectCount}</span>
          </span>
        </div>
        <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden flex">
          <div
            className="bg-success h-full"
            style={{
              width: `${receivingUnits.length ? (passCount / receivingUnits.length) * 100 : 0}%`,
            }}
          />
          <div
            className="bg-destructive h-full"
            style={{
              width: `${receivingUnits.length ? (rejectCount / receivingUnits.length) * 100 : 0}%`,
            }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">
        {receivingUnits.map((unit, idx) => (
          <ReceivingUnitCard
            key={idx}
            unit={unit}
            idx={idx}
            isDuplicate={dupIndices.has(idx)}
            updateReceivingUnit={updateReceivingUnit}
            updateChecklist={updateChecklist}
            onAddPhotos={onAddPhotos}
            onRemovePhoto={onRemovePhoto}
          />
        ))}
        {receivingUnits.length === 0 && (
          <div className="text-center py-8 text-muted-foreground text-sm leading-snug">
            ไม่มีรายการที่รอรับสินค้า
          </div>
        )}
        <div>
          <label className="block text-xs text-muted-foreground mb-1 leading-snug">หมายเหตุ</label>
          <textarea
            value={receivingNotes}
            onChange={(e) => setReceivingNotes(e.target.value)}
            rows={2}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm leading-snug focus-visible:ring-2 focus-visible:ring-ring/30 outline-hidden"
            placeholder="บันทึกเพิ่มเติม…"
          />
        </div>
      </div>

      {/* Sticky footer */}
      <div className="shrink-0 border-t px-4 sm:px-6 py-3 flex gap-3 bg-background/95 backdrop-blur-xs">
        <button
          type="button"
          onClick={onClose}
          className="min-h-11 px-4 text-sm text-muted-foreground"
        >
          ยกเลิก
        </button>
        <button
          type="submit"
          disabled={goodsReceivingMutation.isPending || receivingUnits.length === 0}
          className="flex-1 min-h-11 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {goodsReceivingMutation.isPending ? 'กำลังรับสินค้า…' : 'ยืนยันรับสินค้า'}
        </button>
      </div>
    </form>
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
            <DrawerTitle className="leading-snug">
              รับสินค้า — {selectedPO?.poNumber || ''}
            </DrawerTitle>
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
      aria-label="รับสินค้า"
    >
      <div className="w-full max-w-3xl bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="size-4" /> กลับ
          </button>
          <h2 className="text-lg font-semibold text-foreground leading-snug">
            รับสินค้า — {selectedPO?.poNumber || ''}
          </h2>
          <div className="w-16" />
        </div>
        {selectedPO && body}
      </div>
    </div>
  );
}
