import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '@/lib/api';

interface ContractAccess {
  contract: {
    contractNumber: string;
    status: string;
    totalMonths: number;
    monthlyPayment: number;
    financedAmount: number;
    customer: { name: string };
    product: { name: string; brand: string; model: string };
  };
  payments: Array<{
    installmentNo: number;
    amountDue: number;
    amountPaid: number;
    dueDate: string;
    status: string;
    lateFee: number;
  }>;
  documents: Array<{
    id: string;
    type: string;
    fileName: string;
    createdAt: string;
  }>;
  signatures: Array<{
    signerType: string;
    signerName: string;
    signedAt: string;
  }>;
  receipts: Array<{
    receiptNumber: string;
    amount: number;
    paidDate: string;
    receiptType: string;
  }>;
  expiresAt: string;
}

const statusLabels: Record<string, string> = {
  ACTIVE: 'ผ่อนอยู่',
  COMPLETED: 'ชำระครบ',
  OVERDUE: 'ค้างชำระ',
  DEFAULT: 'ผิดนัด',
  PAID: 'ชำระแล้ว',
  PENDING: 'รอชำระ',
  PARTIALLY_PAID: 'ชำระบางส่วน',
};

const paymentStatusColors: Record<string, string> = {
  PAID: 'bg-green-100 text-green-700',
  PENDING: 'bg-gray-100 text-gray-600',
  OVERDUE: 'bg-red-100 text-red-700',
  PARTIALLY_PAID: 'bg-yellow-100 text-yellow-700',
};

function CustomerPortalPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ContractAccess | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    api.get(`/customer-access/${token}`)
      .then(({ data }) => setData(data))
      .catch((err) => {
        setError(err.response?.data?.message || 'ลิงก์ไม่ถูกต้องหรือหมดอายุ');
      })
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-3 text-sm text-gray-500">กำลังโหลดข้อมูล...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="bg-white rounded-lg border p-8 max-w-md text-center">
          <div className="text-4xl mb-4">🔒</div>
          <h1 className="text-lg font-semibold text-gray-900 mb-2">ไม่สามารถเข้าถึงได้</h1>
          <p className="text-sm text-gray-500">{error || 'ลิงก์ไม่ถูกต้องหรือหมดอายุ'}</p>
          <p className="text-xs text-gray-400 mt-3">กรุณาติดต่อร้านเพื่อขอลิงก์ใหม่</p>
        </div>
      </div>
    );
  }

  const c = data.contract;
  const totalPaid = data.payments.reduce((sum, p) => sum + Number(p.amountPaid), 0);
  const totalDue = data.payments.reduce((sum, p) => sum + Number(p.amountDue) + Number(p.lateFee), 0);
  const paidCount = data.payments.filter((p) => p.status === 'PAID').length;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-gray-900">BESTCHOICE</h1>
              <p className="text-xs text-gray-500">ข้อมูลสัญญาผ่อนชำระ</p>
            </div>
            <div className="text-xs text-gray-400">
              หมดอายุ: {new Date(data.expiresAt).toLocaleString('th-TH')}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {/* Contract Summary */}
        <div className="bg-white rounded-lg border p-4">
          <div className="flex justify-between items-start mb-3">
            <div>
              <div className="text-xs text-gray-500">สัญญาเลขที่</div>
              <div className="font-bold text-lg">{c.contractNumber}</div>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${
              c.status === 'ACTIVE' ? 'bg-green-100 text-green-700' :
              c.status === 'COMPLETED' ? 'bg-blue-100 text-blue-700' :
              'bg-yellow-100 text-yellow-700'
            }`}>
              {statusLabels[c.status] || c.status}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-gray-500">ลูกค้า:</span> {c.customer.name}</div>
            <div><span className="text-gray-500">สินค้า:</span> {c.product.brand} {c.product.model}</div>
            <div><span className="text-gray-500">ยอดจัดไฟแนนซ์:</span> {Number(c.financedAmount).toLocaleString()} ฿</div>
            <div><span className="text-gray-500">ค่างวด:</span> {Number(c.monthlyPayment).toLocaleString()} ฿/เดือน</div>
          </div>
        </div>

        {/* Progress */}
        <div className="bg-white rounded-lg border p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium">ความคืบหน้า</span>
            <span className="text-sm text-gray-500">{paidCount}/{c.totalMonths} งวด</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-3 mb-2">
            <div
              className="bg-green-500 h-3 rounded-full transition-all"
              style={{ width: `${(paidCount / c.totalMonths) * 100}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-gray-500">
            <span>ชำระแล้ว: {totalPaid.toLocaleString()} ฿</span>
            <span>คงเหลือ: {Math.max(0, totalDue - totalPaid).toLocaleString()} ฿</span>
          </div>
        </div>

        {/* Payment Schedule */}
        <div className="bg-white rounded-lg border">
          <div className="px-4 py-3 border-b">
            <h3 className="text-sm font-semibold">ตารางผ่อนชำระ</h3>
          </div>
          <div className="divide-y max-h-80 overflow-y-auto">
            {data.payments.map((p) => (
              <div key={p.installmentNo} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">งวดที่ {p.installmentNo}</div>
                  <div className="text-xs text-gray-500">
                    กำหนด: {new Date(p.dueDate).toLocaleDateString('th-TH')}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm">{Number(p.amountDue).toLocaleString()} ฿</div>
                  {Number(p.lateFee) > 0 && (
                    <div className="text-xs text-red-500">+ค่าปรับ {Number(p.lateFee).toLocaleString()} ฿</div>
                  )}
                  <span className={`px-2 py-0.5 rounded-full text-xs ${paymentStatusColors[p.status] || 'bg-gray-100 text-gray-600'}`}>
                    {statusLabels[p.status] || p.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Receipts */}
        {data.receipts.length > 0 && (
          <div className="bg-white rounded-lg border">
            <div className="px-4 py-3 border-b">
              <h3 className="text-sm font-semibold">ใบเสร็จรับเงิน</h3>
            </div>
            <div className="divide-y">
              {data.receipts.map((r, i) => (
                <div key={i} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-mono">{r.receiptNumber}</div>
                    <div className="text-xs text-gray-500">{new Date(r.paidDate).toLocaleDateString('th-TH')}</div>
                  </div>
                  <div className="text-sm font-medium">{Number(r.amount).toLocaleString()} ฿</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Signatures */}
        {data.signatures.length > 0 && (
          <div className="bg-white rounded-lg border p-4">
            <h3 className="text-sm font-semibold mb-2">การลงนาม</h3>
            <div className="grid grid-cols-2 gap-2">
              {data.signatures.map((s, i) => (
                <div key={i} className="text-xs p-2 bg-green-50 rounded">
                  <div className="font-medium">{s.signerName}</div>
                  <div className="text-gray-500">{s.signerType} - {new Date(s.signedAt).toLocaleDateString('th-TH')}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-gray-400 py-4">
          <p>เอกสารนี้สร้างโดยระบบ BESTCHOICE อัตโนมัติ</p>
          <p>ข้อมูล ณ วันที่ {new Date().toLocaleDateString('th-TH')}</p>
        </div>
      </div>
    </div>
  );
}

export default CustomerPortalPage;
