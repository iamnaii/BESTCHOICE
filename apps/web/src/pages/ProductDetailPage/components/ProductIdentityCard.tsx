import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Copy, ImageIcon, Smartphone } from 'lucide-react';
import { toast } from 'sonner';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { IPHONE_COLORS } from '@/components/product/VariantSelector';
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard';
import { categoryLabels } from '@/lib/constants';
import { formatDateShort } from '@/utils/formatters';

export interface ProductForIdentity {
  id: string;
  name: string;
  brand: string;
  model: string;
  color: string | null;
  storage: string | null;
  imeiSerial: string | null;
  serialNumber: string | null;
  category: string;
  batteryHealth: number | null;
  warrantyExpired: boolean | null;
  warrantyExpireDate: string | null;
  hasBox: boolean | null;
  accessoryType: string | null;
  accessoryBrand: string | null;
  createdAt: string;
  branch: { id: string; name: string };
  supplier: { id: string; name: string } | null;
  po: { id: string; poNumber: string } | null;
  conditionGrade?: string | null;
  shopWarrantyDays?: number | null;
  accessoriesIncluded?: string[] | null;
  cosmeticNotes?: string | null;
}

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

interface PhotoData {
  productId: string;
  applicable?: boolean;
  photos?: Partial<Record<Angle, string | null>>;
}

/** product.color เก็บค่าอังกฤษดิบ — แปลงเป็น "สีดำ" เมื่อ map ได้ (เหมือน buildCustomerSummary) */
function colorLabel(color: string | null): string | null {
  const raw = (color ?? '').trim();
  if (!raw) return null;
  const match = IPHONE_COLORS.find((c) => c.value === raw);
  return match ? `สี${match.label}` : raw;
}

function Field({ label, value, mono, span }: { label: string; value: string | null | undefined; mono?: boolean; span?: number }) {
  return (
    <div className={cn('min-w-0', span === 2 && 'col-span-2')}>
      <div className="text-xs text-muted-foreground leading-snug">{label}</div>
      <div
        className={cn(
          'truncate text-sm leading-snug',
          mono && value && 'font-mono text-[13px] tracking-wide',
          !value && 'text-muted-foreground',
        )}
      >
        {value || '—'}
      </div>
    </div>
  );
}

function Chip({ children }: { children: string }) {
  return (
    <span className="inline-flex h-6 items-center rounded-md bg-muted/70 px-2 text-xs font-medium leading-snug">
      {children}
    </span>
  );
}

/**
 * การ์ดข้อมูลเครื่อง (แทน ProductInfo): รูป + ชื่อรุ่น + ชิปสเปก + IMEI/Serial คัดลอกได้ + ตาราง 4 คอลัมน์
 * มือสองมีแถบรูป 6 มุมจากตอนรับเครื่อง
 */
export default function ProductIdentityCard({
  product,
  onGoPhotos,
}: {
  product: ProductForIdentity;
  onGoPhotos: () => void;
}) {
  const { copy } = useCopyToClipboard();
  const isUsed = product.category === 'PHONE_USED';
  const isAccessory = product.category === 'ACCESSORY';

  // query key เดียวกับ OnlineListingPanel → ยิงครั้งเดียวต่อหน้า
  const { data: photoData } = useQuery<PhotoData>({
    queryKey: ['product-photos', product.id],
    queryFn: async () => {
      const { data } = await api.get(`/products/${product.id}/photos`);
      return data;
    },
    enabled: isUsed,
  });
  const photos = photoData?.photos ?? {};
  const photoCount = ANGLES.filter((a) => photos[a]).length;

  const handleCopy = async (text: string, what: string) => {
    const ok = await copy(text);
    if (ok) toast.success(`คัดลอก${what}แล้ว`);
    else toast.error('คัดลอกไม่สำเร็จ กรุณาลองใหม่');
  };

  const chips: string[] = [];
  if (!isAccessory) {
    if (product.storage) chips.push(product.storage);
    const color = colorLabel(product.color);
    if (color) chips.push(color);
  }
  // หมวดสินค้าอยู่ที่ป้ายหัวการ์ดแล้ว — ชิปเก็บเฉพาะสเปก/สภาพ
  if (isUsed && product.conditionGrade) chips.push(`เกรด ${product.conditionGrade}`);
  if (isUsed && product.batteryHealth != null) chips.push(`แบต ${product.batteryHealth}%`);
  if (product.shopWarrantyDays != null) chips.push(`ประกันร้าน ${product.shopWarrantyDays} วัน`);

  const warrantyText = product.warrantyExpired
    ? 'หมดประกันแล้ว'
    : product.warrantyExpireDate
      ? `ถึง ${formatDateShort(product.warrantyExpireDate)}`
      : null;

  const frontPhoto = isUsed ? photos.front : null;

  return (
    <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
      <CardHeader>
        <CardTitle>ข้อมูลเครื่อง</CardTitle>
        <div className="flex items-center gap-2">
          <Badge variant="info" appearance="light" size="sm">
            {categoryLabels[product.category] || product.category}
          </Badge>
          <Badge variant="secondary" appearance="light" size="sm">
            สาขา{product.branch.name}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-4">
          <div className="flex size-22 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-border bg-muted/35 text-muted-foreground">
            {frontPhoto ? (
              <img src={frontPhoto} alt="รูปหน้าเครื่อง" className="size-full object-cover" />
            ) : (
              <div className="flex flex-col items-center gap-1 text-[11px] leading-snug">
                {isAccessory ? <ImageIcon className="size-5" aria-hidden /> : <Smartphone className="size-5" aria-hidden />}
                ยังไม่มีรูป
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-2">
            <h3 className="text-lg font-semibold leading-snug">
              {product.brand} {product.model}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {chips.map((c) => (
                <Chip key={c}>{c}</Chip>
              ))}
            </div>
            {!isAccessory && (
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[13px] leading-snug">
                {(
                  [
                    ['IMEI', product.imeiSerial],
                    ['Serial', product.serialNumber],
                  ] as const
                ).map(([label, value]) => (
                  <span key={label} className="inline-flex items-center gap-1.5">
                    <span className="text-muted-foreground">{label}</span>
                    {value ? (
                      <>
                        <span className="font-mono font-medium tracking-wide">{value}</span>
                        <button
                          type="button"
                          aria-label={`คัดลอก ${label}`}
                          onClick={() => handleCopy(value, label)}
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <Copy className="size-3.5" aria-hidden />
                        </button>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {isUsed && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex gap-1.5">
              {ANGLES.map((angle) => {
                const url = photos[angle];
                return (
                  <div
                    key={angle}
                    className="relative size-18 overflow-hidden rounded-md border border-border bg-muted/50"
                  >
                    {url ? (
                      <img src={url} alt={`รูป${ANGLE_LABELS[angle]}`} className="size-full object-cover" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-muted-foreground/60">
                        <Smartphone className="size-6" aria-hidden />
                      </div>
                    )}
                    <span className="absolute inset-x-0 bottom-0 bg-black/45 py-0.5 text-center text-[10px] font-semibold text-white leading-snug">
                      {ANGLE_LABELS[angle]}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="space-y-1 text-xs text-muted-foreground leading-snug">
              <div>รูป 6 มุมจากตอนรับเครื่อง · ครบ {photoCount}/6</div>
              <button
                type="button"
                onClick={onGoPhotos}
                className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
              >
                จัดการรูป / เลือกรูปขึ้นเว็บ
                <ChevronRight className="size-3.5" aria-hidden />
              </button>
            </div>
          </div>
        )}

        <div className="h-px bg-border" />

        <div className="grid grid-cols-2 gap-x-4 gap-y-3.5 md:grid-cols-4">
          {isAccessory && (
            <>
              <Field label="ประเภทอุปกรณ์" value={product.accessoryType} />
              {product.accessoryType === 'ชุดชาร์จ' ? (
                <Field label="ชนิด" value={product.model} />
              ) : (
                <>
                  <Field label="สำหรับยี่ห้อ" value={product.brand} />
                  <Field label="สำหรับรุ่น" value={product.model} />
                </>
              )}
              <Field label="ยี่ห้ออุปกรณ์" value={product.accessoryBrand} />
            </>
          )}
          {isUsed && (
            <>
              <Field
                label="แบตเตอรี่"
                value={product.batteryHealth != null ? `${product.batteryHealth}%` : null}
              />
              <Field label="ประกันศูนย์" value={warrantyText} />
              <Field
                label="กล่อง"
                value={product.hasBox != null ? (product.hasBox ? 'มีกล่อง' : 'ไม่มีกล่อง') : null}
              />
              <Field label="เกรดเครื่อง" value={product.conditionGrade} />
            </>
          )}
          <Field
            label="ประกันร้าน"
            value={product.shopWarrantyDays != null ? `${product.shopWarrantyDays} วัน` : null}
          />
          <Field
            label="อุปกรณ์ที่แถม"
            value={
              product.accessoriesIncluded && product.accessoriesIncluded.length > 0
                ? product.accessoriesIncluded.join(', ')
                : null
            }
          />
          <Field label="ตำหนิ" value={product.cosmeticNotes} span={2} />
          <Field label="สาขา" value={product.branch.name} />
          <Field label="ผู้จัดจำหน่าย" value={product.supplier?.name} />
          <Field label="PO" value={product.po?.poNumber} mono />
          <Field label="วันที่เพิ่ม" value={formatDateShort(product.createdAt)} />
        </div>
      </CardContent>
    </Card>
  );
}
