import { Card, CardHeader, CardContent, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { categoryLabels, transferableStatuses } from '@/lib/constants';
import { getStatusBadgeProps, productStatusMap, conditionGradeMap } from '@/lib/status-badges';
import { formatDateShort } from '@/utils/formatters';

interface Price {
  id: string;
  label: string;
  amount: string;
  isDefault: boolean;
}

interface Product {
  id: string;
  name: string;
  brand: string;
  model: string;
  color: string | null;
  storage: string | null;
  imeiSerial: string | null;
  serialNumber: string | null;
  category: string;
  costPrice?: string;     // optional — server strip ทิ้งเมื่อ role = SALES (Task 1)
  status: string;
  batteryHealth: number | null;
  warrantyExpired: boolean | null;
  warrantyExpireDate: string | null;
  hasBox: boolean | null;
  accessoryType: string | null;
  accessoryBrand: string | null;
  photos: string[];
  createdAt: string;
  branch: { id: string; name: string };
  supplier: { id: string; name: string } | null;
  po: { id: string; poNumber: string } | null;
  inspection: { id: string; overallGrade: string | null; isCompleted: boolean } | null;
  prices: Price[];
  conditionGrade?: string | null;
  shopWarrantyDays?: number | null;
  accessoriesIncluded?: string[] | null;
  cosmeticNotes?: string | null;
}

interface ProductInfoProps {
  product: Product;
  isManager: boolean;
  /** FM/ACCOUNTANT เห็นทุนได้ แต่ SALES ไม่ได้ (server ก็ strip แล้ว) */
  canSeeCost: boolean;
  profit: number | null;
}

export default function ProductInfo({
  product,
  isManager: _isManager,
  canSeeCost,
  profit,
}: ProductInfoProps) {
  const statusCfg = getStatusBadgeProps(product.status, productStatusMap);

  return (
    <>
      {/* Product Info */}
      <Card className="mb-5 lg:mb-7.5 rounded-xl border border-border/50 bg-card shadow-sm">
        <CardHeader>
          <CardTitle>ข้อมูลสินค้า</CardTitle>
          <Badge variant={statusCfg.variant} appearance={statusCfg.appearance} size="sm">{statusCfg.label}</Badge>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-5 lg:gap-7.5">
            {product.category === 'ACCESSORY' ? (
              <>
                <InfoField label="ประเภทอุปกรณ์" value={product.accessoryType} />
                {product.accessoryType === 'ชุดชาร์จ' ? (
                  <InfoField label="ชนิด" value={product.model} />
                ) : (
                  <>
                    <InfoField label="สำหรับยี่ห้อ" value={product.brand} />
                    <InfoField label="สำหรับรุ่น" value={product.model} />
                  </>
                )}
                <InfoField label="ยี่ห้ออุปกรณ์" value={product.accessoryBrand} />
              </>
            ) : (
              <>
                <InfoField label="ยี่ห้อ" value={product.brand} />
                <InfoField label="รุ่น" value={product.model} />
                <InfoField label="สี" value={product.color} />
                <InfoField label="ความจุ" value={product.storage} />
                <InfoField label="IMEI" value={product.imeiSerial} mono />
                <InfoField label="Serial Number" value={product.serialNumber} mono />
              </>
            )}
            <InfoField label="ประเภท" value={categoryLabels[product.category] || product.category} />
            {product.category === 'PHONE_USED' && (
              <>
                <InfoField label="แบตเตอรี่" value={product.batteryHealth != null ? `${product.batteryHealth}%` : null} />
                <InfoField
                  label="ประกันศูนย์"
                  value={
                    product.warrantyExpired
                      ? 'หมดประกันแล้ว'
                      : product.warrantyExpireDate
                      ? `ถึง ${formatDateShort(product.warrantyExpireDate)}`
                      : null
                  }
                />
                <InfoField label="กล่อง" value={product.hasBox != null ? (product.hasBox ? 'มีกล่อง' : 'ไม่มีกล่อง') : null} />
                <InfoField
                  label="เกรดเครื่อง"
                  value={product.conditionGrade ? `เกรด ${product.conditionGrade}` : null}
                />
              </>
            )}
            <InfoField
              label="ประกันร้าน"
              value={product.shopWarrantyDays != null ? `${product.shopWarrantyDays} วัน` : null}
            />
            <InfoField
              label="อุปกรณ์ที่แถม"
              value={
                product.accessoriesIncluded && product.accessoriesIncluded.length > 0
                  ? product.accessoriesIncluded.join(', ')
                  : null
              }
            />
            <InfoField label="ตำหนิ" value={product.cosmeticNotes} />
            <InfoField label="สาขา" value={product.branch.name} />
            <InfoField label="ผู้จัดจำหน่าย" value={product.supplier?.name} />
            <InfoField label="PO" value={product.po?.poNumber} mono />
            <InfoField label="วันที่เพิ่ม" value={formatDateShort(product.createdAt)} />
          </div>
        </CardContent>
      </Card>

      {/* Price Summary — ทุน/กำไรเป็นข้อมูลต้นทุน: ซ่อนทั้งบล็อกจาก SALES
          (server ก็ strip costPrice ให้แล้วที่ products.controller.ts) */}
      {canSeeCost && (
        <div className="grid grid-cols-2 gap-5 lg:gap-7.5 mb-5 lg:mb-7.5">
          <Card className="rounded-xl border border-border/50 bg-card shadow-sm relative overflow-hidden hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200">
            <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-full bg-warning" />
            <CardContent className="p-5">
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ราคาทุน</div>
              <div className="text-lg font-semibold text-foreground tabular-nums font-mono">
                {product.costPrice != null ? `${parseFloat(product.costPrice).toLocaleString()} ฿` : '-'}
              </div>
            </CardContent>
          </Card>
          <Card className="rounded-xl border border-border/50 bg-card shadow-sm relative overflow-hidden hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200">
            <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-full bg-success" />
            <CardContent className="p-5">
              <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">กำไร</div>
              <div
                className={`text-lg font-semibold tabular-nums font-mono ${
                  profit === null
                    ? 'text-muted-foreground'
                    : profit > 0
                    ? 'text-success'
                    : profit === 0
                    ? 'text-muted-foreground'
                    : 'text-destructive'
                }`}
              >
                {profit !== null ? `${profit.toLocaleString()} ฿` : '-'}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ราคาในระบบเดิม (prices[]) — read-only, กำลังเลิกใช้ตาม owner decision §1.1 */}
      <details className="mb-5 lg:mb-7.5 rounded-xl border border-border/50 bg-card shadow-sm">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-muted-foreground leading-snug">
          ราคาในระบบเดิม ({product.prices.length}) — อ่านอย่างเดียว
        </summary>
        <div className="px-5 pb-4 space-y-2">
          {product.prices.map((price) => (
            <div key={price.id} className="flex items-center justify-between py-1.5">
              <div className="flex items-center gap-3">
                <span className="text-sm text-foreground leading-snug">{price.label}</span>
                {price.isDefault && (
                  <span className="px-1.5 py-0.5 bg-primary/10 text-primary text-xs rounded font-medium leading-snug">
                    ค่าเริ่มต้น
                  </span>
                )}
              </div>
              <span className="text-sm font-semibold tabular-nums">
                {parseFloat(price.amount).toLocaleString()} ฿
              </span>
            </div>
          ))}
          {product.prices.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-3 leading-snug">
              ยังไม่มีข้อมูลราคาเดิม
            </p>
          )}
        </div>
      </details>

      {/* Inspection Result (if applicable) */}
      {product.inspection && (
        <Card className="mb-5 lg:mb-7.5 rounded-xl border border-border/50 bg-card shadow-sm">
          <CardHeader>
            <CardTitle>ผลตรวจเช็ค</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-4">
              <Badge
                variant={product.inspection.isCompleted ? 'success' : 'warning'}
                appearance="light"
                size="sm"
              >
                {product.inspection.isCompleted ? 'ตรวจเสร็จ' : 'กำลังตรวจ'}
              </Badge>
              {product.inspection.overallGrade && (() => {
                const gradeCfg = getStatusBadgeProps(product.inspection.overallGrade!, conditionGradeMap);
                return <Badge variant={gradeCfg.variant} appearance={gradeCfg.appearance} size="sm">{gradeCfg.label}</Badge>;
              })()}
            </div>
          </CardContent>
        </Card>
      )}
    </>
  );
}

function InfoField({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
      <div className={`text-sm text-foreground ${mono ? 'font-mono' : ''}`}>{value || '-'}</div>
    </div>
  );
}
