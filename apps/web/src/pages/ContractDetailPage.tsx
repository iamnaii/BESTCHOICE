import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import PageHeader from '@/components/ui/PageHeader';
import DataTable from '@/components/ui/DataTable';
import toast from 'react-hot-toast';
import { useState } from 'react';
import Modal from '@/components/ui/Modal';

interface Payment {
  id: string;
  installmentNo: number;
  dueDate: string;
  amountDue: string;
  amountPaid: string | null;
  lateFee: string;
  status: string;
  paidDate: string | null;
  paymentMethod: string | null;
}

interface ContractDetail {
  id: string;
  contractNumber: string;
  status: string;
  planType: string;
  sellingPrice: string;
  downPayment: string;
  interestRate: string;
  totalMonths: number;
  interestTotal: string;
  financedAmount: string;
  monthlyPayment: string;
  notes: string | null;
  createdAt: string;
  customer: { id: string; name: string; phone: string; nationalId: string };
  product: { id: string; name: string; brand: string; model: string; serialNumber: string | null; imei: string | null };
  branch: { id: string; name: string };
  salesperson: { id: string; name: string };
  payments: Payment[];
}

interface EarlyPayoffQuote {
  remainingMonths: number;
  remainingPrincipal: number;
  remainingInterest: number;
  discount: number;
  unpaidLateFees: number;
  totalPayoff: number;
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

const paymentStatusLabels: Record<string, { label: string; className: string }> = {
  PENDING: { label: 'รอชำระ', className: 'bg-gray-100 text-gray-700' },
  PAID: { label: 'ชำระแล้ว', className: 'bg-green-100 text-green-700' },
  OVERDUE: { label: 'เกินกำหนด', className: 'bg-red-100 text-red-700' },
  PARTIAL: { label: 'ชำระบางส่วน', className: 'bg-yellow-100 text-yellow-700' },
};

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showPayoffModal, setShowPayoffModal] = useState(false);
  const [payoffMethod, setPayoffMethod] = useState('CASH');

  const { data: contract, isLoading } = useQuery<ContractDetail>({
    queryKey: ['contract', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}`); return data; },
  });

  const { data: payoffQuote } = useQuery<EarlyPayoffQuote>({
    queryKey: ['contract-payoff', id],
    queryFn: async () => { const { data } = await api.get(`/contracts/${id}/early-payoff-quote`); return data; },
    enabled: !!contract && ['ACTIVE', 'OVERDUE'].includes(contract.status),
  });

  const activateMutation = useMutation({
    mutationFn: async () => { const { data } = await api.post(`/contracts/${id}/activate`); return data; },
    onSuccess: () => { toast.success('เปิดใช้งานสัญญาแล้ว'); queryClient.invalidateQueries({ queryKey: ['contract', id] }); },
    onError: (err: any) => toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด'),
  });

  const earlyPayoffMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/contracts/${id}/early-payoff`, { paymentMethod: payoffMethod });
      return data;
    },
    onSuccess: () => {
      toast.success('ปิดสัญญาก่อนกำหนดสำเร็จ');
      setShowPayoffModal(false);
      queryClient.invalidateQueries({ queryKey: ['contract', id] });
    },
    onError: (err: any) => toast.error(err.response?.data?.message || 'เกิดข้อผิดพลาด'),
  });

  if (isLoading || !contract) {
    return <div className="flex items-center justify-center py-12"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div></div>;
  }

  const s = statusLabels[contract.status] || { label: contract.status, className: 'bg-gray-100' };
  const paidCount = contract.payments.filter((p) => p.status === 'PAID').length;

  const paymentColumns = [
    { key: 'installmentNo', label: 'งวดที่', render: (p: Payment) => <span className="font-medium">{p.installmentNo}</span> },
    { key: 'dueDate', label: 'วันครบกำหนด', render: (p: Payment) => <span className="text-sm">{new Date(p.dueDate).toLocaleDateString('th-TH')}</span> },
    { key: 'amountDue', label: 'ยอดที่ต้องชำระ', render: (p: Payment) => <span className="text-sm">{parseFloat(p.amountDue).toLocaleString()} ฿</span> },
    {
      key: 'amountPaid',
      label: 'ยอดที่ชำระ',
      render: (p: Payment) => p.amountPaid ? <span className="text-sm text-green-600">{parseFloat(p.amountPaid).toLocaleString()} ฿</span> : <span className="text-xs text-gray-400">-</span>,
    },
    {
      key: 'lateFee',
      label: 'ค่าปรับ',
      render: (p: Payment) => {
        const fee = parseFloat(p.lateFee);
        return fee > 0 ? <span className="text-sm text-red-600">{fee.toLocaleString()} ฿</span> : <span className="text-xs text-gray-400">-</span>;
      },
    },
    {
      key: 'status',
      label: 'สถานะ',
      render: (p: Payment) => {
        const ps = paymentStatusLabels[p.status] || { label: p.status, className: 'bg-gray-100' };
        return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ps.className}`}>{ps.label}</span>;
      },
    },
    {
      key: 'paidDate',
      label: 'วันที่ชำระ',
      render: (p: Payment) => p.paidDate ? <span className="text-xs">{new Date(p.paidDate).toLocaleDateString('th-TH')}</span> : <span className="text-xs text-gray-400">-</span>,
    },
  ];

  return (
    <div>
      <PageHeader
        title={contract.contractNumber}
        subtitle="รายละเอียดสัญญาผ่อนชำระ"
        action={
          <div className="flex gap-2">
            <button onClick={() => navigate(`/contracts/${id}/sign`)} className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700">
              ลงนาม/เอกสาร
            </button>
            {contract.status === 'DRAFT' && (
              <button onClick={() => activateMutation.mutate()} disabled={activateMutation.isPending} className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
                {activateMutation.isPending ? 'กำลังเปิด...' : 'เปิดใช้งานสัญญา'}
              </button>
            )}
            {['ACTIVE', 'OVERDUE'].includes(contract.status) && (
              <button onClick={() => setShowPayoffModal(true)} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                ปิดก่อนกำหนด
              </button>
            )}
            <button onClick={() => navigate('/contracts')} className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg">
              กลับ
            </button>
          </div>
        }
      />

      {/* Status + Summary */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500 mb-1">สถานะ</div>
          <span className={`px-3 py-1 rounded-full text-sm font-medium ${s.className}`}>{s.label}</span>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500 mb-1">ค่างวด/เดือน</div>
          <div className="text-xl font-bold text-primary-700">{parseFloat(contract.monthlyPayment).toLocaleString()} ฿</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500 mb-1">ชำระแล้ว</div>
          <div className="text-xl font-bold text-green-600">{paidCount}/{contract.totalMonths} งวด</div>
        </div>
        <div className="bg-white rounded-lg border p-4">
          <div className="text-xs text-gray-500 mb-1">ยอดผ่อนรวม</div>
          <div className="text-xl font-bold">{parseFloat(contract.financedAmount).toLocaleString()} ฿</div>
        </div>
      </div>

      {/* Contract Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <div className="bg-white rounded-lg border p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">ข้อมูลสัญญา</h2>
          <div className="grid grid-cols-2 gap-3">
            <Info label="ประเภทแผน" value={contract.planType} />
            <Info label="ราคาขาย" value={`${parseFloat(contract.sellingPrice).toLocaleString()} ฿`} />
            <Info label="เงินดาวน์" value={`${parseFloat(contract.downPayment).toLocaleString()} ฿`} />
            <Info label="อัตราดอกเบี้ย" value={`${(parseFloat(contract.interestRate) * 100).toFixed(1)}%`} />
            <Info label="ดอกเบี้ยรวม" value={`${parseFloat(contract.interestTotal).toLocaleString()} ฿`} />
            <Info label="จำนวนงวด" value={`${contract.totalMonths} เดือน`} />
            <Info label="พนักงานขาย" value={contract.salesperson.name} />
            <Info label="สาขา" value={contract.branch.name} />
            <Info label="วันที่สร้าง" value={new Date(contract.createdAt).toLocaleDateString('th-TH')} />
            {contract.notes && <Info label="หมายเหตุ" value={contract.notes} />}
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg border p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">ข้อมูลลูกค้า</h2>
            <div className="grid grid-cols-2 gap-3">
              <Info label="ชื่อ" value={contract.customer.name} />
              <Info label="เบอร์โทร" value={contract.customer.phone} />
            </div>
            <button onClick={() => navigate(`/customers/${contract.customer.id}`)} className="mt-3 text-xs text-primary-600 hover:underline">ดูรายละเอียดลูกค้า</button>
          </div>

          <div className="bg-white rounded-lg border p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">ข้อมูลสินค้า</h2>
            <div className="grid grid-cols-2 gap-3">
              <Info label="สินค้า" value={`${contract.product.brand} ${contract.product.model}`} />
              <Info label="ชื่อ" value={contract.product.name} />
              {contract.product.serialNumber && <Info label="S/N" value={contract.product.serialNumber} />}
              {contract.product.imei && <Info label="IMEI" value={contract.product.imei} />}
            </div>
            <button onClick={() => navigate(`/products/${contract.product.id}`)} className="mt-3 text-xs text-primary-600 hover:underline">ดูรายละเอียดสินค้า</button>
          </div>
        </div>
      </div>

      {/* Early Payoff Quote */}
      {payoffQuote && ['ACTIVE', 'OVERDUE'].includes(contract.status) && (
        <div className="bg-blue-50 rounded-lg border border-blue-200 p-6 mb-6">
          <h2 className="text-lg font-semibold text-blue-800 mb-3">ประเมินปิดก่อนกำหนด</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div><div className="text-xs text-blue-600">งวดคงเหลือ</div><div className="font-medium">{payoffQuote.remainingMonths} งวด</div></div>
            <div><div className="text-xs text-blue-600">เงินต้นคงเหลือ</div><div className="font-medium">{payoffQuote.remainingPrincipal.toLocaleString()} ฿</div></div>
            <div><div className="text-xs text-blue-600">ดอกเบี้ยคงเหลือ</div><div className="font-medium">{payoffQuote.remainingInterest.toLocaleString()} ฿</div></div>
            <div><div className="text-xs text-green-600">ส่วนลดดอกเบี้ย (50%)</div><div className="font-medium text-green-700">-{payoffQuote.discount.toLocaleString()} ฿</div></div>
            {payoffQuote.unpaidLateFees > 0 && <div><div className="text-xs text-red-600">ค่าปรับค้างชำระ</div><div className="font-medium text-red-700">{payoffQuote.unpaidLateFees.toLocaleString()} ฿</div></div>}
            <div><div className="text-xs text-blue-600 font-semibold">ยอดปิดสัญญา</div><div className="text-xl font-bold text-blue-800">{payoffQuote.totalPayoff.toLocaleString()} ฿</div></div>
          </div>
        </div>
      )}

      {/* Payment Schedule */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-3">ตารางผ่อนชำระ ({paidCount}/{contract.totalMonths} งวด)</h2>
        <DataTable columns={paymentColumns} data={contract.payments} emptyMessage="ยังไม่มีตารางผ่อน" />
      </div>

      {/* Early Payoff Modal */}
      {showPayoffModal && payoffQuote && (
        <Modal title="ปิดสัญญาก่อนกำหนด" onClose={() => setShowPayoffModal(false)}>
          <div className="space-y-4">
            <div className="bg-blue-50 rounded-lg p-4">
              <div className="text-sm">ยอดที่ต้องชำระ</div>
              <div className="text-2xl font-bold text-blue-800">{payoffQuote.totalPayoff.toLocaleString()} ฿</div>
              <div className="text-xs text-blue-600 mt-1">(รวมส่วนลดดอกเบี้ย 50% แล้ว)</div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">วิธีชำระ</label>
              <select value={payoffMethod} onChange={(e) => setPayoffMethod(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                <option value="CASH">เงินสด</option>
                <option value="TRANSFER">โอนเงิน</option>
                <option value="CREDIT_CARD">บัตรเครดิต</option>
              </select>
            </div>

            <div className="flex gap-3 pt-2">
              <button onClick={() => setShowPayoffModal(false)} className="flex-1 px-4 py-2 text-sm border border-gray-300 rounded-lg">ยกเลิก</button>
              <button onClick={() => earlyPayoffMutation.mutate()} disabled={earlyPayoffMutation.isPending} className="flex-1 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {earlyPayoffMutation.isPending ? 'กำลังปิด...' : 'ยืนยันปิดสัญญา'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | null | undefined }) {
  return <div><div className="text-xs text-gray-500 mb-0.5">{label}</div><div className="text-sm text-gray-900">{value || '-'}</div></div>;
}
