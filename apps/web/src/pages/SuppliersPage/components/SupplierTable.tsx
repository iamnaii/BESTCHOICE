import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { Building2, User, Phone, MessageCircle, Eye, Pencil } from 'lucide-react';

export interface PaymentMethod {
  id?: string;
  paymentMethod: string;
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
  creditTermDays: string | number;
  isDefault: boolean;
}

export interface Supplier {
  id: string;
  type: 'INDIVIDUAL' | 'JURISTIC';
  name: string;
  titleName: string | null;
  contactName: string | null;
  contactPhone: string | null;
  contactPosition: string | null;
  nickname: string | null;
  branchCode: string | null;
  phone: string;
  phoneSecondary: string | null;
  lineId: string | null;
  address: string | null;
  taxId: string | null;
  hasVat: boolean;
  paymentMethods: PaymentMethod[];
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  _count: { products: number; purchaseOrders: number };
}

interface QueryResult {
  data: Supplier[];
  total: number;
  page: number;
  totalPages: number;
}

interface SupplierTableProps {
  result: QueryResult | undefined;
  suppliers: Supplier[];
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  isManager: boolean;
  onEdit: (supplier: Supplier) => void;
  onToggleActive: (supplier: Supplier) => void;
  onPageChange: (page: number) => void;
  /** id ของแถวที่กำลังบันทึกสถานะอยู่ — ล็อกสวิตช์กันกดซ้ำระหว่างรอผล */
  pendingToggleId?: string | null;
  toolbar?: ReactNode;
}

/** ชื่อที่แสดงบนคอลัมน์แรก — บุคคลธรรมดาเติมคำนำหน้า, `contactName` ของเขาคือชื่อเดียวกันนี้ */
const displayName = (s: Supplier) =>
  s.type === 'INDIVIDUAL' && s.titleName ? `${s.titleName} ${s.name}` : s.name;

const paymentMethodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนธนาคาร',
  CHECK: 'เช็ค',
  CREDIT: 'เครดิต',
};

export default function SupplierTable({
  result,
  suppliers,
  isLoading,
  isError,
  error,
  refetch,
  isManager,
  onEdit,
  onToggleActive,
  onPageChange,
  pendingToggleId,
  toolbar,
}: SupplierTableProps) {
  const navigate = useNavigate();

  const columns = [
    {
      key: 'name',
      label: 'ผู้จัดจำหน่าย',
      render: (s: Supplier) => {
        const isJuristic = s.type === 'JURISTIC';
        const fullName = displayName(s);
        return (
          <div className="flex items-center gap-3 min-w-0">
            <div
              className={cn(
                'flex size-9 shrink-0 items-center justify-center rounded-lg',
                isJuristic ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
              )}
              aria-hidden="true"
            >
              {isJuristic ? <Building2 className="size-4" /> : <User className="size-4" />}
            </div>
            <div className="min-w-0 max-w-64">
              <div className="truncate leading-snug font-medium text-foreground">
                {fullName}
                {s.nickname && (
                  <span className="font-normal text-muted-foreground"> ({s.nickname})</span>
                )}
              </div>
              <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
                <Badge
                  variant={isJuristic ? 'primary' : 'secondary'}
                  appearance="light"
                  size="sm"
                  className="whitespace-nowrap shrink-0"
                >
                  {isJuristic ? 'นิติบุคคล' : 'บุคคลธรรมดา'}
                </Badge>
                {s.taxId && (
                  <span className="text-xs text-muted-foreground tabular-nums truncate">
                    {s.taxId}
                  </span>
                )}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      key: 'contactName',
      label: 'ผู้ติดต่อ',
      render: (s: Supplier) => {
        // บุคคลธรรมดา: `contactName` = ชื่อตัวเองที่โชว์คอลัมน์แรกอยู่แล้ว — ไม่ต้องซ้ำ
        const person =
          s.contactName && s.contactName.trim() !== displayName(s).trim() ? s.contactName : '';
        const personMeta = [s.contactPosition, s.contactPhone].filter(Boolean).join(' · ');
        return (
          <div className="min-w-0 max-w-60 space-y-0.5">
            {person && <div className="truncate leading-snug text-foreground">{person}</div>}
            {personMeta && (
              <div className="truncate text-xs leading-snug text-muted-foreground">
                {personMeta}
              </div>
            )}
            <div className="flex items-center gap-1.5 leading-snug text-foreground">
              <Phone className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="tabular-nums">{s.phone}</span>
              {s.phoneSecondary && (
                <span className="text-xs tabular-nums text-muted-foreground">
                  / {s.phoneSecondary}
                </span>
              )}
            </div>
            {s.lineId && (
              <div className="flex items-center gap-1.5 text-xs leading-snug text-muted-foreground">
                <MessageCircle className="size-3.5 shrink-0" aria-hidden="true" />
                <span className="sr-only">LINE ID </span>
                <span className="truncate">{s.lineId}</span>
              </div>
            )}
          </div>
        );
      },
    },
    {
      key: 'paymentMethods',
      label: 'การชำระเงิน',
      render: (s: Supplier) => (
        <div className="space-y-1">
          <Badge
            variant={s.hasVat ? 'primary' : 'secondary'}
            appearance="light"
            size="sm"
            className="whitespace-nowrap"
          >
            {s.hasVat ? 'มี VAT' : 'ไม่มี VAT'}
          </Badge>
          {s.paymentMethods?.length ? (
            <div className="space-y-0.5">
              {s.paymentMethods.map((pm, i) => (
                <div key={pm.id ?? i} className="flex items-center gap-1 text-sm leading-snug">
                  <span className="whitespace-nowrap">
                    {paymentMethodLabels[pm.paymentMethod] || pm.paymentMethod}
                  </span>
                  {pm.isDefault && (
                    <Badge variant="secondary" appearance="light" size="sm">
                      หลัก
                    </Badge>
                  )}
                  {pm.bankName && (
                    <span className="text-xs text-muted-foreground">({pm.bankName})</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs leading-snug text-muted-foreground">ยังไม่ระบุวิธีชำระ</div>
          )}
        </div>
      ),
    },
    {
      key: 'usage',
      label: 'ประวัติใช้งาน',
      render: (s: Supplier) => (
        <div className="space-y-0.5 whitespace-nowrap text-xs leading-snug text-muted-foreground">
          <div>
            PO{' '}
            <span className="font-medium text-foreground tabular-nums">
              {s._count.purchaseOrders}
            </span>{' '}
            รายการ
          </div>
          <div>
            สินค้า{' '}
            <span className="font-medium text-foreground tabular-nums">{s._count.products}</span>{' '}
            รายการ
          </div>
        </div>
      ),
    },
    {
      key: 'isActive',
      label: 'สถานะ',
      render: (s: Supplier) =>
        isManager ? (
          <div className="-my-2 flex items-center gap-2 py-2" onClick={(e) => e.stopPropagation()}>
            <Switch
              checked={s.isActive}
              disabled={pendingToggleId === s.id}
              onCheckedChange={() => onToggleActive(s)}
              aria-label={`สถานะการใช้งานของ ${s.name}`}
            />
            <span
              className={cn(
                'text-xs leading-snug whitespace-nowrap',
                s.isActive ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {s.isActive ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
            </span>
          </div>
        ) : (
          <Badge variant={s.isActive ? 'success' : 'destructive'} appearance="light" size="sm">
            {s.isActive ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
          </Badge>
        ),
    },
    {
      key: 'actions',
      label: '',
      render: (s: Supplier) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          <Button
            variant="ghost"
            size="icon"
            title="ดูข้อมูล"
            aria-label={`ดูข้อมูล ${s.name}`}
            onClick={() => navigate(`/suppliers/${s.id}`)}
          >
            <Eye />
          </Button>
          {isManager && (
            <Button
              variant="ghost"
              size="icon"
              title="แก้ไข"
              aria-label={`แก้ไข ${s.name}`}
              onClick={() => onEdit(s)}
            >
              <Pencil />
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <QueryBoundary
      isLoading={isLoading && !result}
      isError={isError}
      error={error}
      onRetry={refetch}
      errorTitle="ไม่สามารถโหลดรายชื่อผู้จัดจำหน่ายได้"
    >
      <DataTable
        columns={columns}
        data={suppliers}
        isLoading={isLoading}
        toolbar={toolbar}
        onRowClick={(s) => {
          // ลากเลือกเบอร์โทร/Tax ID แล้วปล่อยเมาส์ = click ที่แถว — อย่าเด้งออกจากหน้า
          if (window.getSelection()?.toString()) return;
          navigate(`/suppliers/${s.id}`);
        }}
        emptyMessage="ไม่พบผู้จัดจำหน่าย"
        emptyIcon={Building2}
        emptyDescription="ลองปรับคำค้นหาหรือตัวกรองสถานะ หรือเพิ่มผู้จัดจำหน่ายรายใหม่"
        pagination={
          result
            ? {
                page: result.page,
                totalPages: result.totalPages,
                total: result.total,
                onPageChange,
              }
            : undefined
        }
      />
    </QueryBoundary>
  );
}
