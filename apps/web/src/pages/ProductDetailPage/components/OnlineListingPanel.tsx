import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowUp, ArrowDown, Trash2 } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useProductReadiness, PRODUCT_READINESS_QUERY_KEY } from '../hooks/useProductReadiness';
import ReadinessCard from './ReadinessCard';
import ProductWarrantyForm from './ProductWarrantyForm';

const ANGLES = ['front', 'back', 'left', 'right', 'top', 'bottom'] as const;
type Angle = (typeof ANGLES)[number];

const ANGLE_LABELS: Record<Angle, string> = {
  front: 'หน้า',
  back: 'หลัง',
  left: 'ซ้าย',
  right: 'ขวา',
  top: 'บน',
  bottom: 'ล่าง',
};

const MAX_GALLERY = 8;
type DeviceOrigin = 'THAI' | 'IMPORTED';

interface PhotoData {
  productId: string;
  applicable?: boolean;
  photos?: Record<Angle, string | null>;
}

interface OnlineListingProduct {
  shopWarrantyDays?: number | null;
  warrantyTerms?: string | null;
  deviceOrigin?: DeviceOrigin | null;
  id: string;
  category: string;
  photos: string[];
  gallery: string[];
  isOnlineVisible: boolean;
  onlineDescription: string | null;
  conditionGrade: string | null;
}

type PromoteDto = { source: 'LEGACY'; index: number } | { source: 'ANGLE'; angle: Angle };

export default function OnlineListingPanel({
  product,
  canEdit,
}: {
  product: OnlineListingProduct;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const readiness = useProductReadiness(product.id);
  const [localGallery, setLocalGallery] = useState<string[]>(product.gallery);
  const [description, setDescription] = useState(product.onlineDescription ?? '');
  const [deviceOrigin, setDeviceOrigin] = useState<DeviceOrigin | ''>(product.deviceOrigin ?? '');

  useEffect(() => {
    setDeviceOrigin(product.deviceOrigin ?? '');
  }, [product.id, product.deviceOrigin]);
  // Last server gallery this component has reconciled against — lets the
  // resync effect below tell "brand-new URL from the server" apart from
  // "URL the user just removed locally", instead of only comparing to the
  // live localGallery snapshot.
  const knownServerGalleryRef = useRef<string[]>(product.gallery);

  // Resync the local reorder buffer whenever the server gallery actually
  // changes (react-query only hands us a new array reference after a real
  // refetch, not on incidental re-renders). If there were no unsaved edits,
  // just take the fresh server state. If there WERE unsaved edits
  // (reorder/remove not yet saved via "บันทึกการจัดเรียง"), preserve them and
  // only append URLs that are brand-new since the last known server state
  // (e.g. a photo just promoted from the picker below) — this is what keeps
  // an in-progress reorder from being clobbered by an unrelated promote's
  // refetch, instead of silently resetting to the server order.
  useEffect(() => {
    const known = knownServerGalleryRef.current;
    const next = product.gallery;
    if (next === known) return;

    setLocalGallery((prevLocal) => {
      const wasDirty = JSON.stringify(prevLocal) !== JSON.stringify(known);
      if (!wasDirty) return next;
      const newlyAdded = next.filter((url) => !known.includes(url));
      return newlyAdded.length > 0 ? [...prevLocal, ...newlyAdded] : prevLocal;
    });
    knownServerGalleryRef.current = next;
  }, [product.gallery]);

  useEffect(() => {
    setDescription(product.onlineDescription ?? '');
  }, [product.onlineDescription]);

  const { data: photosData } = useQuery<PhotoData>({
    queryKey: ['product-photos', product.id],
    queryFn: async () => {
      const { data } = await api.get(`/products/${product.id}/photos`);
      return data;
    },
    enabled: product.category === 'PHONE_USED',
  });

  const invalidateProduct = () => Promise.all([['product', product.id], ['stock-list'], ['products'], ['pos-products'], ['products-available']].map(queryKey => queryClient.invalidateQueries({ queryKey })));
  // gallery/photos/visibility all feed evaluateReadiness() (PHOTO/IN_STOCK/SHOP_GATE
  // checks etc.) directly — invalidate the readiness card alongside the product on
  // every mutation that can move it, or the card shows a stale checklist for up to
  // staleTime (3 min, refetchOnWindowFocus off).
  const invalidateReadiness = () =>
    queryClient.invalidateQueries({ queryKey: PRODUCT_READINESS_QUERY_KEY(product.id) });

  const saveGalleryMutation = useMutation({
    mutationFn: async () => api.patch(`/products/${product.id}/online-listing`, { gallery: localGallery }),
    onSuccess: () => {
      invalidateProduct();
      invalidateReadiness();
      toast.success('บันทึกการจัดเรียงรูปสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const promoteMutation = useMutation({
    mutationFn: async (dto: PromoteDto) => api.post(`/products/${product.id}/online-listing/photos`, dto),
    onSuccess: () => {
      invalidateProduct();
      invalidateReadiness();
      toast.success('ส่งรูปขึ้นเว็บสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const toggleMutation = useMutation({
    mutationFn: async (isOnlineVisible: boolean) =>
      api.patch(`/products/${product.id}/online-listing`, { isOnlineVisible }),
    onSuccess: () => {
      invalidateProduct();
      invalidateReadiness();
      toast.success('อัปเดตสถานะแสดงบนเว็บสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const originMutation = useMutation({
    mutationFn: () => api.patch(`/products/${product.id}/online-listing`, { deviceOrigin: deviceOrigin || null }),
    onSuccess: () => {
      invalidateProduct();
      toast.success('บันทึกประเภทเครื่องสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const descriptionMutation = useMutation({
    mutationFn: async () => api.patch(`/products/${product.id}/online-listing`, { onlineDescription: description }),
    onSuccess: () => {
      invalidateProduct();
      toast.success('บันทึกคำอธิบายสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const isDirtyGallery = useMemo(
    () => JSON.stringify(localGallery) !== JSON.stringify(product.gallery),
    [localGallery, product.gallery],
  );
  const isDirtyDescription = description !== (product.onlineDescription ?? '');

  // Gate against the server's gallery length (source of truth the API will
  // actually enforce), not the unsaved local buffer — an unsaved local
  // removal doesn't free up room on the server until "บันทึกการจัดเรียง" lands.
  const galleryFull = product.gallery.length >= MAX_GALLERY;

  const anglePhotos = useMemo(
    () =>
      photosData?.photos
        ? ANGLES.filter((a) => photosData.photos?.[a]).map((a) => ({ angle: a, url: photosData.photos![a] as string }))
        : [],
    [photosData],
  );

  const hasAnySource = product.photos.length > 0 || anglePhotos.length > 0;

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    setLocalGallery((prev) => {
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return next;
    });
  };

  const moveDown = (idx: number) => {
    setLocalGallery((prev) => {
      if (idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return next;
    });
  };

  const removeAt = (idx: number) => {
    setLocalGallery((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-4">
      <ReadinessCard isLoading={readiness.isLoading} isError={readiness.isError} data={readiness.data} />
      <ProductWarrantyForm product={product} canEdit={canEdit} />

      {/* รูปที่ขึ้นเว็บ */}
      <div className="bg-card rounded-lg border p-4">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-foreground leading-snug">
            รูปที่ขึ้นเว็บ ({localGallery.length}/{MAX_GALLERY})
          </h2>
          <button
            onClick={() => saveGalleryMutation.mutate()}
            disabled={!canEdit || !isDirtyGallery || saveGalleryMutation.isPending}
            className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs font-medium leading-snug hover:bg-primary/90 disabled:opacity-50"
          >
            {saveGalleryMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกการจัดเรียง'}
          </button>
        </div>

        {localGallery.length === 0 ? (
          <p className="text-sm text-muted-foreground leading-snug">
            ยังไม่มีรูปขึ้นเว็บ — เลือกจากรูปในระบบด้านล่างเพื่อส่งขึ้นเว็บ
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {localGallery.map((url, idx) => (
              <div key={url} className="relative border border-border rounded-lg overflow-hidden">
                <div className="aspect-square bg-muted">
                  <img src={url} alt={`รูปที่ขึ้นเว็บลำดับ ${idx + 1}`} className="w-full h-full object-cover" />
                </div>
                <div className="flex items-center justify-between gap-1 p-1 bg-card border-t border-border">
                  <button
                    onClick={() => moveUp(idx)}
                    disabled={!canEdit || idx === 0}
                    title="เลื่อนขึ้น"
                    aria-label="เลื่อนขึ้น"
                    className="p-1 rounded hover:bg-accent disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <ArrowUp className="size-3.5 text-muted-foreground" />
                  </button>
                  <button
                    onClick={() => moveDown(idx)}
                    disabled={!canEdit || idx === localGallery.length - 1}
                    title="เลื่อนลง"
                    aria-label="เลื่อนลง"
                    className="p-1 rounded hover:bg-accent disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <ArrowDown className="size-3.5 text-muted-foreground" />
                  </button>
                  <button
                    onClick={() => removeAt(idx)}
                    disabled={!canEdit}
                    title="ลบออกจากแกลเลอรี"
                    aria-label="ลบรูป"
                    className="p-1 rounded hover:bg-destructive/10 disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* เลือกจากรูปในระบบ */}
      <div className="bg-card rounded-lg border p-4">
        <h2 className="text-sm font-semibold text-foreground leading-snug mb-3">เลือกจากรูปในระบบ</h2>

        {!hasAnySource && (
          <p className="text-sm text-muted-foreground leading-snug">ยังไม่มีรูปในระบบให้เลือก</p>
        )}

        {product.photos.length > 0 && (
          <div className="mb-4">
            <div className="text-xs font-medium text-muted-foreground mb-2 leading-snug">รูปจากการตรวจรับ</div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {product.photos.map((photo, idx) => (
                <div key={idx} className="relative">
                  <div className="aspect-square rounded overflow-hidden border border-border">
                    <img src={photo} alt={`รูปตรวจรับลำดับ ${idx + 1}`} className="w-full h-full object-cover" />
                  </div>
                  <Badge
                    variant="outline"
                    className="absolute top-1 left-1 text-[10px] px-1.5 py-0 bg-background/90 leading-snug"
                  >
                    ตรวจรับ
                  </Badge>
                  <button
                    onClick={() => promoteMutation.mutate({ source: 'LEGACY', index: idx })}
                    disabled={!canEdit || galleryFull || promoteMutation.isPending}
                    className="w-full mt-1 px-1 py-0.5 bg-primary/5 rounded text-[10px] text-primary leading-snug hover:bg-primary/10 font-medium disabled:opacity-50"
                  >
                    ส่งขึ้นเว็บ
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {anglePhotos.length > 0 && (
          <div>
            <div className="text-xs font-medium text-muted-foreground mb-2 leading-snug">รูปถ่าย 6 มุม</div>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {anglePhotos.map(({ angle, url }) => (
                <div key={angle} className="relative">
                  <div className="aspect-square rounded overflow-hidden border border-border">
                    <img src={url} alt={ANGLE_LABELS[angle]} className="w-full h-full object-cover" />
                  </div>
                  <Badge
                    variant="outline"
                    className="absolute top-1 left-1 text-[10px] px-1.5 py-0 bg-background/90 leading-snug"
                  >
                    {ANGLE_LABELS[angle]}
                  </Badge>
                  <button
                    onClick={() => promoteMutation.mutate({ source: 'ANGLE', angle })}
                    disabled={!canEdit || galleryFull || promoteMutation.isPending}
                    className="w-full mt-1 px-1 py-0.5 bg-primary/5 rounded text-[10px] text-primary leading-snug hover:bg-primary/10 font-medium disabled:opacity-50"
                  >
                    ส่งขึ้นเว็บ
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* สถานะ + คำอธิบาย */}
      <div className="bg-card rounded-lg border p-4 space-y-4">
        <div>
          <Label htmlFor="device-origin" className="block text-sm mb-2">เครื่องไทย / เครื่องนอก</Label>
          <div className="flex flex-wrap items-center gap-2">
            <select
              id="device-origin"
              value={deviceOrigin}
              onChange={(e) => setDeviceOrigin(e.target.value as DeviceOrigin | '')}
              disabled={!canEdit || originMutation.isPending}
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm disabled:opacity-50"
            >
              <option value="">ยังไม่ระบุ</option>
              <option value="THAI">เครื่องไทย</option>
              <option value="IMPORTED">เครื่องนอก</option>
            </select>
            <button
              type="button"
              onClick={() => originMutation.mutate()}
              disabled={!canEdit || deviceOrigin === (product.deviceOrigin ?? '') || originMutation.isPending}
              className="px-3 py-2 bg-primary text-primary-foreground rounded text-xs font-medium disabled:opacity-50"
            >
              {originMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกประเภทเครื่อง'}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground leading-snug">
            ระบุตามตลาดที่จำหน่ายเครื่อง ไม่ใช่ประเทศที่ผลิต ข้อมูลนี้แสดงบนเว็บและใช้กรองสินค้า
            หากยังไม่ได้ตรวจสอบให้เลือก “ยังไม่ระบุ”
          </p>
        </div>

        <div>
          <div className="flex items-center gap-3">
            <Switch
              id="online-visible"
              checked={product.isOnlineVisible}
              disabled={!canEdit || toggleMutation.isPending}
              onCheckedChange={(checked) => toggleMutation.mutate(checked)}
            />
            <Label htmlFor="online-visible" className="text-sm leading-snug">
              แสดงบนเว็บ shop
            </Label>
          </div>
          <p className="ml-6 mt-1 text-xs text-muted-foreground leading-snug">
            ปิดสวิตช์นี้เพื่อซ่อนเครื่องนี้จากเว็บลูกค้า — เงื่อนไข "ข้อมูลครบ" ดูที่การ์ดสถานะขึ้นเว็บ
          </p>
        </div>

        <div>
          <label className="block text-xs font-medium text-foreground mb-1 leading-snug">
            คำอธิบายสำหรับเว็บ shop
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!canEdit}
            maxLength={2000}
            rows={4}
            placeholder="รายละเอียดสินค้าที่จะแสดงบนเว็บ shop"
            className="w-full px-3 py-2 border border-input rounded-lg text-sm leading-snug resize-none disabled:opacity-50 disabled:bg-muted"
          />
          <div className="flex items-center justify-between mt-1 gap-2 flex-wrap">
            <span className="text-[11px] text-muted-foreground leading-snug">{description.length}/2000</span>
            <button
              onClick={() => descriptionMutation.mutate()}
              disabled={!canEdit || !isDirtyDescription || descriptionMutation.isPending}
              className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs font-medium leading-snug hover:bg-primary/90 disabled:opacity-50"
            >
              {descriptionMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกคำอธิบาย'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
