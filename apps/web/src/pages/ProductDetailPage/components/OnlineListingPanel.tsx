import { NativeSelect } from '@/components/ui/native-select';
import type { ReactNode } from 'react';
import { useId as useUiFieldId, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowUp, ArrowDown, Trash2 } from '@/lib/icons';
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
  defaultShopWarrantyDays?: number;
  defaultWarrantyTerms?: string;
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
  onlineCoverAngle?: Angle | null;
  usesAutomaticPhotos?: boolean;
}

type PromoteDto = { source: 'LEGACY'; index: number } | { source: 'ANGLE'; angle: Angle };

export default function OnlineListingPanel({
  product,
  canEdit,
  onGoPhotos,
  onEditPrice,
  productInfo,
  pricing,
  calculator,
  additionalInfo,
}: {
  product: OnlineListingProduct;
  canEdit: boolean;
  onGoPhotos?: () => void;
  onEditPrice?: () => void;
  productInfo?: ReactNode;
  pricing?: ReactNode;
  calculator?: ReactNode;
  additionalInfo?: ReactNode;
}) {
  const uiFieldId = useUiFieldId();
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

  const { data: photosData, isLoading: photosLoading, isError: photosError, refetch: retryPhotos } = useQuery<PhotoData>({
    queryKey: ['product-photos', product.id],
    queryFn: async () => {
      const { data } = await api.get(`/products/${product.id}/photos`);
      return data;
    },
    enabled: product.category !== 'ACCESSORY',
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

  const coverMutation = useMutation({
    mutationFn: (angle: Angle) => api.patch(`/products/${product.id}/online-listing`, { onlineCoverAngle: angle }),
    onSuccess: async () => { await invalidateProduct(); toast.success('เปลี่ยนรูปปกแล้ว'); },
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

  const automaticPhotos = product.usesAutomaticPhotos || anglePhotos.length > 0;
  const cover = anglePhotos.some(p => p.angle === product.onlineCoverAngle)
    ? product.onlineCoverAngle : anglePhotos[0]?.angle;

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
      {productInfo && <div className="min-w-0 lg:col-start-1 lg:row-start-1">{productInfo}</div>}
      <aside className="min-w-0 space-y-4 lg:sticky lg:top-[76px] lg:col-start-2 lg:row-start-1 lg:row-span-2">
        {pricing}
        <div className="rounded-xl border bg-card p-5 space-y-3">
          <h2 className="font-semibold">การแสดงบนเว็บ</h2>
          <div className="flex items-center justify-between gap-3">
            <Label htmlFor="online-visible">เปิดแสดงบนเว็บ</Label>
            <Switch id="online-visible" checked={product.isOnlineVisible}
              disabled={!canEdit || toggleMutation.isPending}
              onCheckedChange={checked => toggleMutation.mutate(checked)} />
          </div>
          <p className="text-sm text-muted-foreground leading-snug">มีผลทันที · สินค้าจะแสดงเมื่อข้อมูลครบและอยู่ในสต็อก</p>
          {toggleMutation.isPending && <p role="status" className="text-sm">กำลังอัปเดต...</p>}
        </div>
        <ReadinessCard isLoading={readiness.isLoading} isError={readiness.isError} data={readiness.data}
          availableActions={[...(onGoPhotos ? ['gallery'] : []), ...(onEditPrice ? ['cashPrice'] : []), ...(canEdit ? ['isOnlineVisible'] : [])]}
          onRetry={() => void readiness.refetch()} onFix={key => {
            if (key === 'gallery') onGoPhotos?.();
            else if (key === 'cashPrice') onEditPrice?.();
            else if (key === 'isOnlineVisible') document.getElementById('online-visible')?.focus();
          }} />
        {calculator}
      </aside>
      <div className={`min-w-0 space-y-4 lg:col-start-1 ${productInfo ? 'lg:row-start-2' : 'lg:row-start-1'}`}>
        {product.category !== 'ACCESSORY' && <section className="rounded-xl border bg-card p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">รูปสินค้า 6 ด้าน</h2>
              <p className="mt-1 text-sm text-muted-foreground leading-snug">ใช้รูปที่บันทึกไว้อัตโนมัติ · ไม่ต้องส่งขึ้นเว็บซ้ำ</p>
            </div>
            {onGoPhotos && <button type="button" onClick={onGoPhotos} className="min-h-11 rounded-lg border px-3 text-sm hover:bg-accent">จัดการรูปถ่าย</button>}
          </div>
          {photosLoading && <p role="status" className="text-sm text-muted-foreground">กำลังโหลดรูปสินค้า...</p>}
          {photosError && <div role="alert" className="text-sm">โหลดรูปไม่สำเร็จ <button type="button" className="min-h-11 underline" onClick={() => void retryPhotos()}>ลองใหม่</button></div>}
          {!photosLoading && !photosError && anglePhotos.length === 0 && <p className="text-sm text-muted-foreground">ยังไม่มีรูป 6 ด้าน · เพิ่มได้ที่แท็บรูปถ่าย</p>}
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {anglePhotos.map(({ angle, url }) => <button key={angle}
                  type="button" aria-label={`ใช้รูปด้าน${ANGLE_LABELS[angle]}เป็นปก`} aria-pressed={cover === angle}
                  disabled={!canEdit || coverMutation.isPending || cover === angle}
                  onClick={() => coverMutation.mutate(angle)}
                  className={`min-w-0 overflow-hidden rounded-lg border text-left hover:bg-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default ${cover === angle ? 'border-primary bg-primary/5' : 'border-border'}`}>
              <div className="h-20 bg-muted sm:h-24"><img src={url} alt={`รูปด้าน${ANGLE_LABELS[angle]}`} className="h-full w-full object-contain" /></div>
              <div className="flex min-h-11 flex-wrap items-center justify-between gap-1 px-2 py-1 text-xs leading-snug">
                <span>{ANGLE_LABELS[angle]}</span>
                {cover === angle && <span className="font-medium text-primary">ปก</span>}
              </div>
            </button>)}
          </div>
          {anglePhotos.length > 0 && <p className="text-xs text-muted-foreground leading-snug">{canEdit ? 'แตะรูปเพื่อเลือกปก · มีผลทันที' : 'รูปที่มีป้าย “ปก” จะแสดงเป็นรูปแรกบนเว็บ'} · เมื่อแก้รูปในแท็บรูปถ่าย รูปบนเว็บจะเปลี่ยนตาม</p>}
        </section>}

      {!automaticPhotos && !photosLoading && !photosError && <>
      {/* รูปที่ขึ้นเว็บ */}
      <div className="bg-card rounded-lg border p-4">
        <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
          <h2 className="text-sm font-semibold text-foreground leading-snug">
            รูปที่ขึ้นเว็บ ({localGallery.length}/{MAX_GALLERY})
          </h2>
          <button data-ui-control="button"
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
                  <button data-ui-control="button" data-ui-icon="true"
                    onClick={() => moveUp(idx)}
                    disabled={!canEdit || idx === 0}
                    title="เลื่อนขึ้น"
                    aria-label="เลื่อนขึ้น"
                    className="p-1 rounded hover:bg-accent disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <ArrowUp className="size-3.5 text-muted-foreground" />
                  </button>
                  <button data-ui-control="button" data-ui-icon="true"
                    onClick={() => moveDown(idx)}
                    disabled={!canEdit || idx === localGallery.length - 1}
                    title="เลื่อนลง"
                    aria-label="เลื่อนลง"
                    className="p-1 rounded hover:bg-accent disabled:opacity-30 disabled:pointer-events-none"
                  >
                    <ArrowDown className="size-3.5 text-muted-foreground" />
                  </button>
                  <button data-ui-control="button" data-ui-icon="true"
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
                  <button data-ui-control="button"
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


      </div>

      </>}

      {/* ข้อมูลที่ลูกค้าเห็น */}
      <div className="bg-card rounded-lg border p-4 space-y-4">
        <div>
          <Label htmlFor="device-origin" className="block text-sm mb-2">เครื่องไทย / เครื่องนอก</Label>
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect wrapperClassName="max-w-full w-auto"
              id="device-origin"
              value={deviceOrigin}
              onChange={(e) => setDeviceOrigin(e.target.value as DeviceOrigin | '')}
              disabled={!canEdit || originMutation.isPending}
            >
              <option value="">ยังไม่ระบุ</option>
              <option value="THAI">เครื่องไทย</option>
              <option value="IMPORTED">เครื่องนอก</option>
            </NativeSelect>
            <button data-ui-control="button"
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
          <label htmlFor={`${uiFieldId}-1`} className="block text-xs font-medium text-foreground mb-1 leading-snug">
            รายละเอียดเพิ่มเติมให้ลูกค้าเห็น (ไม่จำเป็นต้องกรอก)
          </label>
          <textarea id={`${uiFieldId}-1`}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={!canEdit}
            maxLength={2000}
            rows={4}
            placeholder="เช่น รอยตำหนิ อุปกรณ์ที่ได้รับ หรือข้อมูลเพิ่มเติมที่ลูกค้าควรทราบ"
            className="w-full px-3 py-2 border border-input rounded-lg text-sm leading-snug resize-none disabled:opacity-50 disabled:bg-muted"
          />
          <div className="flex items-center justify-between mt-1 gap-2 flex-wrap">
            <span className="text-[11px] text-muted-foreground leading-snug">{description.length}/2000</span>
            <button data-ui-control="button"
              onClick={() => descriptionMutation.mutate()}
              disabled={!canEdit || !isDirtyDescription || descriptionMutation.isPending}
              className="px-3 py-1.5 bg-primary text-primary-foreground rounded text-xs font-medium leading-snug hover:bg-primary/90 disabled:opacity-50"
            >
              {descriptionMutation.isPending ? 'กำลังบันทึก...' : 'บันทึกคำอธิบาย'}
            </button>
          </div>
        </div>
      </div>
      <details className="rounded-xl border bg-card p-4">
        <summary className="min-h-11 cursor-pointer font-medium leading-snug">ประกันร้าน · {product.shopWarrantyDays == null ? 'ใช้ค่ามาตรฐานร้าน' : `${product.shopWarrantyDays} วัน`}</summary>
        <ProductWarrantyForm product={product} canEdit={canEdit} />
      </details>
      {additionalInfo}
      </div>
    </div>
  );
}
