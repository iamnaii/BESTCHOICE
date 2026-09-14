import { Badge } from '@/components/ui/badge';
import DataTable from '@/components/ui/DataTable';
import LineLinkInvite from '@/components/customer/LineLinkInvite';
import { formatDateShort } from '@/utils/formatters';
import type { CustomerDetail } from '../types';

interface SalesTabProps {
  customer: CustomerDetail;
}

export default function SalesTab({ customer }: SalesTabProps) {
  type SaleRow = NonNullable<CustomerDetail['sales']>[number];
  const purchases = customer.sales ?? [];
  const saleColumns = [
    {
      key: 'saleNumber',
      label: 'เลขที่ใบขาย',
      render: (s: SaleRow) => <span className="font-mono text-sm tabular-nums">{s.saleNumber}</span>,
    },
    {
      key: 'product',
      label: 'สินค้า',
      render: (s: SaleRow) => (
        <div className="min-w-0">
          <div className="text-sm text-foreground leading-snug">
            {s.product ? `${s.product.brand} ${s.product.model}` : '—'}
          </div>
          {s.product?.imeiSerial && (
            <div className="text-xs text-muted-foreground tabular-nums">{s.product.imeiSerial}</div>
          )}
        </div>
      ),
    },
    {
      key: 'saleType',
      label: 'ประเภท',
      render: (s: SaleRow) => (
        <Badge variant={s.saleType === 'CASH' ? 'success' : 'info'} appearance="light" size="sm">
          {s.saleType === 'CASH' ? 'เงินสด' : 'ไฟแนนซ์นอก'}
        </Badge>
      ),
    },
    {
      key: 'netAmount',
      label: 'ยอดสุทธิ',
      render: (s: SaleRow) => (
        <span className="text-sm tabular-nums font-mono">
          {parseFloat(s.netAmount).toLocaleString()} ฿
        </span>
      ),
    },
    {
      key: 'warranty',
      label: 'ประกันร้าน',
      render: (s: SaleRow) =>
        s.shopWarrantyEndDate ? (
          <span className="text-sm">ถึง {formatDateShort(s.shopWarrantyEndDate)}</span>
        ) : (
          // เครื่องใหม่ใช้ประกันศูนย์อย่างเดียวตามนโยบาย — ไม่ใช่ข้อมูลขาด
          <span className="text-xs text-muted-foreground">ประกันศูนย์</span>
        ),
    },
    {
      key: 'createdAt',
      label: 'วันที่ซื้อ',
      render: (s: SaleRow) => <span className="text-sm">{formatDateShort(s.createdAt)}</span>,
    },
  ];

  return (
    <>
      {/* ประกัน/แจ้งเตือนทางไลน์ใช้ `lineIdShop` เป็นตัวระบุ — ลูกค้าที่ยังไม่ผูก
          จะไม่ได้รับอะไรเลย จึงชวนผูกตรงจุดที่พนักงานกำลังคุยเรื่องเครื่องกับลูกค้าพอดี */}
      <div className="mb-4">
        <LineLinkInvite lineIdShop={customer.lineIdShop} customerName={customer.name} />
      </div>
      <div className="mb-6">
        <DataTable
          columns={saleColumns}
          data={purchases}
          emptyMessage="ยังไม่มีการซื้อแบบเงินสด/ไฟแนนซ์นอก"
        />
      </div>
    </>
  );
}
