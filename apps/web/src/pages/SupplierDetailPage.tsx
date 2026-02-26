import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import { displayAddress } from '@/components/ui/AddressForm';

interface Supplier {
  id: string;
  name: string;
  contactName: string;
  nickname: string | null;
  phone: string;
  phoneSecondary: string | null;
  lineId: string | null;
  address: string | null;
  taxId: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  _count: { products: number; purchaseOrders: number };
}

interface ProductRecord {
  id: string;
  name: string;
  brand: string;
  model: string;
  imeiSerial: string | null;
  category: string;
  costPrice: string;
  status: string;
  conditionGrade: string | null;
  createdAt: string;
  branch: { id: string; name: string };
  po: { id: string; poNumber: string; orderDate: string } | null;
}

interface PORecord {
  id: string;
  poNumber: string;
  orderDate: string;
  expectedDate: string | null;
  status: string;
  totalAmount: string;
  notes: string | null;
  createdAt: string;
  createdBy: { id: string; name: string };
  items: { id: string; brand: string; model: string; quantity: number; unitPrice: string; receivedQty: number }[];
  _count: { products: number };
}

const statusLabels: Record<string, { label: string; className: string }> = {
  PO_RECEIVED: { label: 'รับจาก PO', className: 'bg-blue-100 text-blue-700' },
  INSPECTION: { label: 'กำลังตรวจ', className: 'bg-yellow-100 text-yellow-700' },
  IN_STOCK: { label: 'พร้อมขาย', className: 'bg-green-100 text-green-700' },
  RESERVED: { label: 'จอง', className: 'bg-purple-100 text-purple-700' },
  SOLD_INSTALLMENT: { label: 'ขายผ่อน', className: 'bg-indigo-100 text-indigo-700' },
  SOLD_CASH: { label: 'ขายสด', className: 'bg-teal-100 text-teal-700' },
  REPOSSESSED: { label: 'ยึดคืน', className: 'bg-red-100 text-red-700' },
  REFURBISHED: { label: 'ซ่อมแล้ว', className: 'bg-orange-100 text-orange-700' },
  SOLD_RESELL: { label: 'ขายต่อ', className: 'bg-cyan-100 text-cyan-700' },
};

const poStatusLabels: Record<string, { label: string; className: string }> = {
  DRAFT: { label: 'ร่าง', className: 'bg-gray-100 text-gray-700' },
  APPROVED: { label: 'อนุมัติ', className: 'bg-blue-100 text-blue-700' },
  PARTIALLY_RECEIVED: { label: 'รับบางส่วน', className: 'bg-yellow-100 text-yellow-700' },
  FULLY_RECEIVED: { label: 'รับครบ', className: 'bg-green-100 text-green-700' },
  CANCELLED: { label: 'ยกเลิก', className: 'bg-red-100 text-red-700' },
};

const categoryLabels: Record<string, string> = {
  PHONE_NEW: 'มือถือใหม่',
  PHONE_USED: 'มือถือมือสอง',
  TABLET: 'แท็บเล็ต',
  ACCESSORY: 'อุปกรณ์เสริม',
};

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: supplier, isLoading: supplierLoading } = useQuery<Supplier>({
    queryKey: ['supplier', id],
    queryFn: async () => {
      const { data } = await api.get(`/suppliers/${id}`);
      return data;
    },
  });

  const { data: history, isLoading: historyLoading } = useQuery<{
    products: ProductRecord[];
    purchaseOrders: PORecord[];
  }>({
    queryKey: ['supplier-history', id],
    queryFn: async () => {
      const { data } = await api.get(`/suppliers/${id}/purchase-history`);
      return data;
    },
  });

  if (supplierLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!supplier) {
    return <div className="text-center py-12 text-gray-500">ไม่พบข้อมูล Supplier</div>;
  }

  const totalCost = history?.products.reduce((sum, p) => sum + parseFloat(p.costPrice), 0) || 0;

  const productColumns = [
    { key: 'name', label: 'สินค้า', render: (p: ProductRecord) => (
      <div>
        <div className="font-medium">{p.brand} {p.model}</div>
        <div className="text-xs text-gray-400">{p.name}</div>
      </div>
    )},
    { key: 'imeiSerial', label: 'IMEI/Serial', render: (p: ProductRecord) => (
      <span className="font-mono text-xs">{p.imeiSerial || '-'}</span>
    )},
    { key: 'category', label: 'ประเภท', render: (p: ProductRecord) => (
      <span className="text-xs">{categoryLabels[p.category] || p.category}</span>
    )},
    { key: 'costPrice', label: 'ราคาทุน', render: (p: ProductRecord) => (
      <span className="font-medium">{parseFloat(p.costPrice).toLocaleString()} ฿</span>
    )},
    { key: 'status', label: 'สถานะ', render: (p: ProductRecord) => {
      const s = statusLabels[p.status] || { label: p.status, className: 'bg-gray-100 text-gray-700' };
      return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
    }},
    { key: 'branch', label: 'สาขา', render: (p: ProductRecord) => (
      <span className="text-xs">{p.branch.name}</span>
    )},
    { key: 'createdAt', label: 'วันที่รับ', render: (p: ProductRecord) => (
      <span className="text-xs">{new Date(p.createdAt).toLocaleDateString('th-TH')}</span>
    )},
  ];

  const poColumns = [
    { key: 'poNumber', label: 'เลข PO', render: (po: PORecord) => (
      <span className="font-mono text-sm font-medium">{po.poNumber}</span>
    )},
    { key: 'orderDate', label: 'วันที่สั่ง', render: (po: PORecord) => (
      <span className="text-sm">{new Date(po.orderDate).toLocaleDateString('th-TH')}</span>
    )},
    { key: 'status', label: 'สถานะ', render: (po: PORecord) => {
      const s = poStatusLabels[po.status] || { label: po.status, className: 'bg-gray-100 text-gray-700' };
      return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
    }},
    { key: 'items', label: 'รายการ', render: (po: PORecord) => (
      <div className="text-xs">
        {po.items.map((item, i) => (
          <div key={i}>{item.brand} {item.model} x{item.quantity} ({item.receivedQty} รับแล้ว)</div>
        ))}
      </div>
    )},
    { key: 'totalAmount', label: 'ยอดรวม', render: (po: PORecord) => (
      <span className="font-medium">{parseFloat(po.totalAmount).toLocaleString()} ฿</span>
    )},
    { key: 'createdBy', label: 'ผู้สร้าง', render: (po: PORecord) => (
      <span className="text-xs">{po.createdBy.name}</span>
    )},
  ];

  return (
    <div>
      <PageHeader
        title={supplier.name}
        subtitle="รายละเอียด Supplier"
        action={
          <button
            onClick={() => navigate('/suppliers')}
            className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg"
          >
            กลับ
          </button>
        }
      />

      {/* Supplier Info Card */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">ข้อมูล Supplier</h2>
          <span
            className={`px-2 py-0.5 rounded-full text-xs font-medium ${
              supplier.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
            }`}
          >
            {supplier.isActive ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}
          </span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <InfoField label="ชื่อ - นามสกุล (ผู้ติดต่อ)" value={supplier.contactName} />
          <InfoField label="ชื่อเล่น" value={supplier.nickname} />
          <InfoField label="เบอร์โทร" value={supplier.phone} />
          <InfoField label="เบอร์สำรอง" value={supplier.phoneSecondary} />
          <InfoField label="LINE ID" value={supplier.lineId} />
          <InfoField label="เลขประจำตัวผู้เสียภาษี (Tax ID Number)" value={supplier.taxId} />
          <InfoField
            label="วันที่เพิ่ม"
            value={new Date(supplier.createdAt).toLocaleDateString('th-TH')}
          />
          <InfoField label="ที่อยู่" value={displayAddress(supplier.address)} />
          {supplier.notes && <InfoField label="หมายเหตุ" value={supplier.notes} />}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <StatCard label="สินค้าทั้งหมด" value={`${supplier._count.products} ชิ้น`} />
        <StatCard label="PO ทั้งหมด" value={`${supplier._count.purchaseOrders} รายการ`} />
        <StatCard label="มูลค่าสินค้ารวม" value={`${totalCost.toLocaleString()} ฿`} />
      </div>

      {/* Purchase Orders */}
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          Purchase Orders ({history?.purchaseOrders.length || 0})
        </h2>
        <DataTable
          columns={poColumns}
          data={history?.purchaseOrders || []}
          isLoading={historyLoading}
          emptyMessage="ยังไม่มี PO"
        />
      </div>

      {/* Products (Purchase History) */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">
          ประวัติการซื้อสินค้า ({history?.products.length || 0})
        </h2>
        <DataTable
          columns={productColumns}
          data={history?.products || []}
          isLoading={historyLoading}
          emptyMessage="ยังไม่มีสินค้าจาก Supplier นี้"
        />
      </div>
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-0.5">{label}</div>
      <div className="text-sm text-gray-900">{value || '-'}</div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border p-4">
      <div className="text-xs text-gray-500 mb-1">{label}</div>
      <div className="text-lg font-semibold text-gray-900">{value}</div>
    </div>
  );
}
