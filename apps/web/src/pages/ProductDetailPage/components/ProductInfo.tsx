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
  costPrice: string;
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
}

interface ProductInfoProps {
  product: Product;
  isManager: boolean;
  defaultPrice: Price | undefined;
  profit: number | null;
  onAddPrice: () => void;
  onEditPrice: (price: Price) => void;
  onDeletePrice: (priceId: string) => void;
}

export default function ProductInfo({
  product,
  isManager,
  defaultPrice,
  profit,
  onAddPrice,
  onEditPrice,
  onDeletePrice,
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
              </>
            )}
            <InfoField label="สาขา" value={product.branch.name} />
            <InfoField label="ผู้ขาย" value={product.supplier?.name} />
            <InfoField label="PO" value={product.po?.poNumber} mono />
            <InfoField label="วันที่เพิ่ม" value={formatDateShort(product.createdAt)} />
          </div>
        </CardContent>
      </Card>

      {/* Price Summary */}
      <div className="grid grid-cols-3 gap-5 lg:gap-7.5 mb-5 lg:mb-7.5">
        <Card className="rounded-xl border border-border/50 bg-card shadow-sm relative overflow-hidden hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200">
          <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-full bg-warning" />
          <CardContent className="p-5">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ราคาทุน</div>
            <div className="text-lg font-semibold text-foreground tabular-nums font-mono">
              {parseFloat(product.costPrice).toLocaleString()} ฿
            </div>
          </CardContent>
        </Card>
        <Card className="rounded-xl border border-border/50 bg-card shadow-sm relative overflow-hidden hover:shadow-card-hover hover:-translate-y-0.5 transition-all duration-200">
          <div className="absolute left-0 top-0 bottom-0 w-1 rounded-r-full bg-primary" />
          <CardContent className="p-5">
            <div className="text-2xs font-medium text-muted-foreground uppercase tracking-wider mb-2">ราคาขาย (default)</div>
            <div className="text-lg font-semibold text-primary tabular-nums font-mono">
              {defaultPrice ? `${parseFloat(defaultPrice.amount).toLocaleString()} ฿` : '-'}
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

      {/* Prices Table */}
      <Card className="mb-5 lg:mb-7.5 rounded-xl border border-border/50 bg-card shadow-sm">
        <CardHeader>
          <CardTitle>ราคาขาย ({product.prices.length})</CardTitle>
          {isManager && (
            <button onClick={onAddPrice} className="text-sm text-primary hover:text-primary/80 font-medium">
              + เพิ่มราคา
            </button>
          )}
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {product.prices.map((price) => (
              <div key={price.id} className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-muted/50">
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-foreground">{price.label}</span>
                  {price.isDefault && (
                    <span className="px-1.5 py-0.5 bg-primary/10 text-primary text-xs rounded font-medium">
                      ค่าเริ่มต้น
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-sm font-semibold">{parseFloat(price.amount).toLocaleString()} ฿</span>
                  {isManager && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => onEditPrice(price)}
                        className="text-xs text-primary hover:text-primary/80"
                      >
                        แก้ไข
                      </button>
                      <button
                        onClick={() => onDeletePrice(price.id)}
                        className="text-xs text-destructive hover:text-destructive/80"
                      >
                        ลบ
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {product.prices.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">ยังไม่มีราคาขาย</p>
            )}
          </div>
        </CardContent>
      </Card>

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
