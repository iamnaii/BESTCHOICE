import ProductPhotoFields, { type EvidencePhotos, type ProductPhotoKey } from './ProductPhotoFields';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';

interface PhotoData {
  productId: string;
  applicable?: boolean;
  photos?: {
    front: string | null;
    back: string | null;
    left: string | null;
    right: string | null;
    top: string | null;
    bottom: string | null;
  };
  evidencePhotos?: EvidencePhotos;
  isCompleted?: boolean;
  completedCount?: number;
  totalCount?: number;
  /**
   * กดยืนยันรูปซ้ำแล้วยังมีผลอยู่ไหม (= เครื่องยังไม่เข้าคลัง) — มาจาก server ทางเดียว
   * ห้ามให้หน้าจอประกอบกติกาเองจากสถานะสินค้า (ดู `ProductPhotosService.getPhotos`)
   */
  pendingStockEntry?: boolean;
}

/** ผลของ `POST /products/:id/photos/complete` — ดู `ProductPhotosService.completePhotos` */
interface CompletePhotosResult {
  productId: string;
  isCompleted: boolean;
  status: string;
  /** เลื่อนเป็น IN_STOCK ในรอบนี้จริงหรือไม่ */
  enteredStock: boolean;
  /** รูปครบแล้วแต่ยังเข้าคลังไม่ได้ เพราะยังไม่มีราคาขาย */
  needsPrice: boolean;
  message: string;
}

export default function ProductPhotosPanel({
  productId,
  canEdit = false,
}: {
  productId: string;
  canEdit?: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirmDialog, setConfirmDialog] = useState<{ open: boolean; message: string; action: () => void }>({ open: false, message: '', action: () => {} });

  const { data, isLoading } = useQuery<PhotoData>({
    queryKey: ['product-photos', productId],
    queryFn: async () => {
      const { data } = await api.get(`/products/${productId}/photos`);
      return data;
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ angle, photo }: { angle: string; photo: string }) => {
      return api.post(`/products/${productId}/photos/upload`, { angle, photo });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-photos', productId] });
      queryClient.invalidateQueries({ queryKey: ['product', productId] });
      toast.success('อัปโหลดรูปสำเร็จ');
    },
    onError: (err: unknown) => {
      toast.error(getErrorMessage(err));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (angle: string) => {
      return api.delete(`/products/${productId}/photos/${angle}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['product-photos', productId] });
      queryClient.invalidateQueries({ queryKey: ['product', productId] });
      toast.success('ลบรูปสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post<CompletePhotosResult>(
        `/products/${productId}/photos/complete`,
      );
      return data;
    },
    /**
     * Fix round 3 [Minor 4]: ยืนยันรูปครบ **ไม่ได้แปลว่าเข้าคลังเสมอไป** — เครื่องที่ยัง
     * ไม่มีราคาขาย (เช่นเครื่องรับซื้อที่ autofill จากตารางราคากลางไม่ match) จะค้างที่
     * `PHOTO_PENDING` โดยที่รูปถูกบันทึกแล้ว. ข้อความมาจาก server ทางเดียว — หน้าจอ
     * ห้ามเดาเองว่าเข้าคลังหรือยัง (เดิม toast บอก "เข้าคลังเรียบร้อย" ทุกกรณี รวมทั้ง
     * เครื่อง IN_STOCK/RESERVED ที่แค่ยืนยันรูปเฉย ๆ)
     */
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['product-photos', productId] });
      queryClient.invalidateQueries({ queryKey: ['product', productId] });
      const message = data?.message ?? 'ยืนยันรูปครบแล้ว';
      if (data?.needsPrice) toast.warning(message);
      else toast.success(message);
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const changePhoto = async (angle: ProductPhotoKey, photo: string | null) => {
    if (photo) await uploadMutation.mutateAsync({ angle, photo });
    else setConfirmDialog({ open: true, message: 'ลบรูปนี้?', action: () => deleteMutation.mutate(angle) });
  };

  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border p-4 mb-4">
        <div className="animate-pulse space-y-2">
          <div className="h-4 w-32 bg-muted rounded" />
          <div className="grid grid-cols-6 gap-2">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-16 bg-muted rounded" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Accessories retain their generic photo collection.
  if (data && data.applicable === false) return null;

  const photos = data?.photos || { front: null, back: null, left: null, right: null, top: null, bottom: null };
  const isCompleted = data?.isCompleted || false;
  const completedCount = data?.completedCount || 0;

  /**
   * Fix round 4 [Important 1]: เดิมปุ่มขึ้นกับ `!isCompleted` อย่างเดียว ⇒ เมื่อ server
   * (soft gate ของรอบ 3) บันทึกว่ารูปครบแล้วแต่ **ไม่เลื่อนเข้าคลังเพราะยังไม่มีราคา**
   * ปุ่มจะหายถาวร ทั้งที่ toast บอกให้ "ตั้งราคาแล้วกดยืนยันอีกครั้ง" — คำแนะนำที่ทำ
   * ตามไม่ได้ และเครื่องเทิร์นที่ autofill ราคาไม่ match ค้าง `PHOTO_PENDING` เงียบ ๆ
   * (`SALES` ไปต่อไม่ได้เลย ซึ่งเป็น persona ที่ soft gate ตั้งใจปลดตั้งแต่แรก)
   *
   * เงื่อนไขที่ถูกคือ "รูปครบ **และ** ยังไม่เข้าคลัง" — พอเข้าคลังแล้วปุ่มหายตามเดิม
   * เพราะยืนยันซ้ำไม่มีผลอะไร
   */
  const canConfirmPhotos = completedCount === 6 && (!isCompleted || !!data?.pendingStockEntry);

  return (
    <div className="bg-card rounded-lg border p-4 mb-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-foreground">
            รูปถ่าย 6 มุม
          </h2>
          <span className={`text-xs ${isCompleted ? 'text-success font-medium' : 'text-muted-foreground'}`}>
            {isCompleted ? 'ครบแล้ว' : `${completedCount}/6`}
          </span>
        </div>
        {canEdit && canConfirmPhotos && (
          <button data-ui-control="button"
            onClick={() => completeMutation.mutate()}
            disabled={completeMutation.isPending}
            className="px-3 py-1 bg-success text-success-foreground rounded text-xs font-medium hover:bg-success/90 disabled:opacity-50"
          >
            {completeMutation.isPending ? 'ยืนยัน...' : 'ยืนยันรูปครบ'}
          </button>
        )}
      </div>

      {/* Compact progress bar */}
      <div className="w-full bg-muted rounded-full h-1 mb-2">
        <div
          className={`h-1 rounded-full transition-all ${isCompleted ? 'bg-success' : 'bg-primary'}`}
          style={{ width: `${(completedCount / 6) * 100}%` }}
        />
      </div>

      <ProductPhotoFields photos={photos} evidencePhotos={data?.evidencePhotos}
        onChange={canEdit ? changePhoto : undefined}
        disabled={uploadMutation.isPending || deleteMutation.isPending || completeMutation.isPending} />
      <ConfirmDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))} description={confirmDialog.message} variant="destructive" onConfirm={confirmDialog.action} />
    </div>
  );
}
