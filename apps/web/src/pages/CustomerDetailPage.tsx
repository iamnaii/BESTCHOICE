import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';

interface CustomerDetail {
  id: string;
  nationalId: string;
  name: string;
  phone: string;
  phoneSecondary: string | null;
  lineId: string | null;
  addressIdCard: string | null;
  addressCurrent: string | null;
  occupation: string | null;
  workplace: string | null;
  createdAt: string;
  contracts: {
    id: string;
    contractNumber: string;
    status: string;
    sellingPrice: string;
    monthlyPayment: string;
    totalMonths: number;
    createdAt: string;
    product: { id: string; name: string; brand: string; model: string };
    branch: { id: string; name: string };
  }[];
}

interface RiskFlag {
  hasRisk: boolean;
  riskLevel: string;
  overdueContracts: { id: string; contractNumber: string; status: string }[];
}

const statusLabels: Record<string, { label: string; className: string }> = {
  DRAFT: { label: 'ร่าง', className: 'bg-gray-100 text-gray-700' },
  ACTIVE: { label: 'ผ่อนอยู่', className: 'bg-green-100 text-green-700' },
  OVERDUE: { label: 'ค้างชำระ', className: 'bg-yellow-100 text-yellow-700' },
  DEFAULT: { label: 'ผิดนัด', className: 'bg-red-100 text-red-700' },
  EARLY_PAYOFF: { label: 'ปิดก่อน', className: 'bg-blue-100 text-blue-700' },
  COMPLETED: { label: 'ครบ', className: 'bg-teal-100 text-teal-700' },
  EXCHANGED: { label: 'เปลี่ยนเครื่อง', className: 'bg-purple-100 text-purple-700' },
  CLOSED_BAD_DEBT: { label: 'หนี้สูญ', className: 'bg-red-200 text-red-800' },
};

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { data: customer, isLoading } = useQuery<CustomerDetail>({
    queryKey: ['customer', id],
    queryFn: async () => { const { data } = await api.get(`/customers/${id}`); return data; },
  });

  const { data: risk } = useQuery<RiskFlag>({
    queryKey: ['customer-risk', id],
    queryFn: async () => { const { data } = await api.get(`/customers/${id}/risk-flag`); return data; },
  });

  if (isLoading || !customer) {
    return <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;
  }

  const contractColumns = [
    { key: 'contractNumber', label: 'เลขสัญญา', render: (c: CustomerDetail['contracts'][0]) => <span className="font-mono text-sm">{c.contractNumber}</span> },
    { key: 'product', label: 'สินค้า', render: (c: CustomerDetail['contracts'][0]) => <span className="text-sm">{c.product.brand} {c.product.model}</span> },
    { key: 'status', label: 'สถานะ', render: (c: CustomerDetail['contracts'][0]) => {
      const s = statusLabels[c.status] || { label: c.status, className: 'bg-gray-100' };
      return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.className}`}>{s.label}</span>;
    }},
    { key: 'monthlyPayment', label: 'ค่างวด', render: (c: CustomerDetail['contracts'][0]) => <span className="text-sm">{parseFloat(c.monthlyPayment).toLocaleString()} ฿/เดือน</span> },
    { key: 'branch', label: 'สาขา', render: (c: CustomerDetail['contracts'][0]) => <span className="text-xs">{c.branch.name}</span> },
  ];

  return (
    <div>
      <PageHeader title={customer.name} subtitle="รายละเอียดลูกค้า" action={<button onClick={() => navigate('/customers')} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">กลับ</button>} />

      {/* Risk Warning */}
      {risk?.hasRisk && (
        <div className={`rounded-lg p-4 mb-6 ${risk.riskLevel === 'HIGH' ? 'bg-red-50 border border-red-200' : 'bg-yellow-50 border border-yellow-200'}`}>
          <div className={`font-semibold text-sm ${risk.riskLevel === 'HIGH' ? 'text-red-700' : 'text-yellow-700'}`}>
            {risk.riskLevel === 'HIGH' ? 'ลูกค้ามีสัญญาผิดนัด (DEFAULT)' : 'ลูกค้ามีสัญญาค้างชำระ (OVERDUE)'}
          </div>
          <div className="text-xs mt-1">
            {risk.overdueContracts.map((c) => `${c.contractNumber} (${c.status})`).join(', ')}
          </div>
        </div>
      )}

      {/* Customer Info */}
      <div className="bg-white rounded-lg border p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">ข้อมูลส่วนตัว</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <Info label="เลขบัตร ปชช." value={customer.nationalId.replace(/(\d{1})(\d{4})(\d{5})(\d{2})(\d{1})/, '$1-$2-$3-$4-$5')} />
          <Info label="เบอร์โทร" value={customer.phone} />
          <Info label="เบอร์สำรอง" value={customer.phoneSecondary} />
          <Info label="LINE ID" value={customer.lineId} />
          <Info label="อาชีพ" value={customer.occupation} />
          <Info label="สถานที่ทำงาน" value={customer.workplace} />
          <Info label="ที่อยู่ตามบัตร" value={customer.addressIdCard} />
          <Info label="ที่อยู่ปัจจุบัน" value={customer.addressCurrent} />
          <Info label="วันที่เพิ่ม" value={new Date(customer.createdAt).toLocaleDateString('th-TH')} />
        </div>
      </div>

      {/* Contracts */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">สัญญาทั้งหมด ({customer.contracts.length})</h2>
        <DataTable columns={contractColumns} data={customer.contracts} emptyMessage="ยังไม่มีสัญญา" />
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><div className="text-xs text-gray-500 mb-0.5">{label}</div><div className="text-sm text-gray-900">{value || '-'}</div></div>;
}
