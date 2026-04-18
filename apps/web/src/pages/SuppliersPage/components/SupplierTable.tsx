import { useNavigate } from 'react-router';
import DataTable from '@/components/ui/DataTable';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

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
  contactName: string;
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
}

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
}: SupplierTableProps) {
  const navigate = useNavigate();

  const columns = [
    {
      key: 'name',
      label: 'ชื่อผู้ขาย',
      render: (s: Supplier) => {
        const fullName =
          s.type === 'INDIVIDUAL' && s.titleName ? `${s.titleName} ${s.name}` : s.name;
        return (
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Badge
                variant={s.type === 'JURISTIC' ? 'primary' : 'secondary'}
                appearance="light"
                size="sm"
                className="whitespace-nowrap"
              >
                {s.type === 'JURISTIC' ? 'นิติบุคคล' : 'บุคคลธรรมดา'}
              </Badge>
            </div>
            <div className="font-medium text-foreground mt-0.5">{fullName}</div>
          </div>
        );
      },
    },
    {
      key: 'contactName',
      label: 'ผู้ติดต่อ',
      render: (s: Supplier) => (
        <div>
          <div className="text-foreground">{s.contactName || '-'}</div>
          {s.nickname && <div className="text-xs text-muted-foreground">({s.nickname})</div>}
        </div>
      ),
    },
    {
      key: 'phone',
      label: 'เบอร์โทร',
      render: (s: Supplier) => (
        <div>
          <div>{s.phone}</div>
          {s.phoneSecondary && <div className="text-xs text-muted-foreground">{s.phoneSecondary}</div>}
        </div>
      ),
    },
    {
      key: 'hasVat',
      label: 'VAT',
      render: (s: Supplier) => (
        <span
          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
            s.hasVat ? 'bg-primary/10 text-primary dark:bg-primary/15' : 'bg-muted text-muted-foreground'
          }`}
        >
          {s.hasVat ? 'มี VAT' : 'ไม่มี VAT'}
        </span>
      ),
    },
    {
      key: 'paymentMethods',
      label: 'วิธีชำระ',
      render: (s: Supplier) => (
        <div className="space-y-0.5">
          {s.paymentMethods?.length ? (
            s.paymentMethods.map((pm, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className="text-sm">{paymentMethodLabels[pm.paymentMethod] || pm.paymentMethod}</span>
                {pm.isDefault && (
                  <span className="text-2xs bg-warning/10 text-warning dark:bg-warning/15 px-1 rounded">หลัก</span>
                )}
                {pm.bankName && <span className="text-xs text-muted-foreground">({pm.bankName})</span>}
              </div>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">-</span>
          )}
        </div>
      ),
    },
    {
      key: 'isActive',
      label: 'สถานะ',
      render: (s: Supplier) => (
        <Badge variant={s.isActive ? 'success' : 'destructive'} appearance="light" size="sm">
          {s.isActive ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
        </Badge>
      ),
    },
    {
      key: 'detail',
      label: 'ข้อมูล',
      render: (s: Supplier) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/suppliers/${s.id}`);
          }}
          className="text-primary hover:text-primary/90 text-sm font-medium hover:underline"
        >
          ดูข้อมูล
        </button>
      ),
    },
    {
      key: 'edit',
      label: 'แก้ไข',
      render: (s: Supplier) =>
        isManager ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEdit(s);
            }}
            className="text-primary hover:text-primary/90 text-sm font-medium hover:underline"
          >
            แก้ไข
          </button>
        ) : null,
    },
    {
      key: 'toggle',
      label: 'เปิด/ปิดการใช้งาน',
      render: (s: Supplier) =>
        isManager ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleActive(s);
            }}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              s.isActive ? 'bg-success' : 'bg-border'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-background transition-transform ${
                s.isActive ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        ) : (
          <span className="text-xs text-muted-foreground">{s.isActive ? 'เปิด' : 'ปิด'}</span>
        ),
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>รายชื่อผู้ขาย</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <QueryBoundary
          isLoading={isLoading && !result}
          isError={isError}
          error={error}
          onRetry={refetch}
          errorTitle="ไม่สามารถโหลดรายชื่อผู้ขายได้"
        >
          <DataTable
            columns={columns}
            data={suppliers}
            isLoading={isLoading}
            emptyMessage="ไม่พบผู้ขาย"
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
      </CardContent>
    </Card>
  );
}
