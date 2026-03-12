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
  PENDING: 'bg-muted text-muted-foreground',
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
      <div className="min-h-screen bg-muted flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary mx-auto"></div>
          <p className="mt-3 text-sm text-muted-foreground">กำลังโหลดข้อมูล...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center">
        <div className="bg-card rounded-lg border border-border p-8 max-w-md text-center shadow-xs shadow-black/5">
          <div className="text-4xl mb-4">🔒</div>
          <h1 className="text-lg font-semibold text-foreground mb-2">ไม่สามารถเข้าถึงได้</h1>
          <p className="text-sm text-muted-foreground">{error || 'ลิงก์ไม่ถูกต้องหรือหมดอายุ'}</p>
          <p className="text-xs text-muted-foreground mt-3">กรุณาติดต่อร้านเพื่อขอลิงก์ใหม่</p>
        </div>
      </div>
    );
  }

  const c = data.contract;
  const totalPaid = data.payments.reduce((sum, p) => sum + Number(p.amountPaid), 0);
  const totalDue = data.payments.reduce((sum, p) => sum + Number(p.amountDue) + Number(p.lateFee), 0);
  const paidCount = data.payments.filter((p) => p.status === 'PAID').length;

  return (
    <div className="min-h-screen bg-muted">
      {/* Header */}
      <div className="bg-card border-b border-border">
        <div className="max-w-3xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold text-foreground">BESTCHOICE</h1>
              <p className="text-xs text-muted-foreground">ข้อมูลสัญญาผ่อนชำระ</p>
            </div>
            <div className="text-xs text-muted-foreground">
              หมดอายุ: {new Date(data.expiresAt).toLocaleString('th-TH')}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-6 flex flex-col gap-5 lg:gap-7.5">
        {/* Contract Summary */}
        <div className="bg-card rounded-lg border border-border p-4 shadow-xs shadow-black/5">
          <div className="flex justify-between items-start mb-3">
            <div>
              <div className="text-xs text-muted-foreground">สัญญาเลขที่</div>
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
            <div><span className="text-muted-foreground">ลูกค้า:</span> {c.customer.name}</div>
            <div><span className="text-muted-foreground">สินค้า:</span> {c.product.brand} {c.product.model}</div>
            <div><span className="text-muted-foreground">ยอดจัดไฟแนนซ์:</span> {Number(c.financedAmount).toLocaleString()} ฿</div>
            <div><span className="text-muted-foreground">ค่างวด:</span> {Number(c.monthlyPayment).toLocaleString()} ฿/เดือน</div>
          </div>
        </div>

        {/* Progress */}
        <div className="bg-card rounded-lg border border-border p-4 shadow-xs shadow-black/5">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium">ความคืบหน้า</span>
            <span className="text-sm text-muted-foreground">{paidCount}/{c.totalMonths} งวด</span>
          </div>
          <div className="w-full bg-muted rounded-full h-3 mb-2">
            <div
              className="bg-green-500 h-3 rounded-full transition-all"
              style={{ width: `${(paidCount / c.totalMonths) * 100}%` }}
            />
          </div>
          <div className="flex justify-between text-xs text-muted-foreground">
            <span>ชำระแล้ว: {totalPaid.toLocaleString()} ฿</span>
            <span>คงเหลือ: {Math.max(0, totalDue - totalPaid).toLocaleString()} ฿</span>
          </div>
        </div>

        {/* Payment Schedule */}
        <div className="bg-card rounded-lg border border-border shadow-xs shadow-black/5">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-sm font-semibold">ตารางผ่อนชำระ</h3>
          </div>
          <div className="divide-y divide-border max-h-80 overflow-y-auto">
            {data.payments.map((p) => (
              <div key={p.installmentNo} className="px-4 py-3 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">งวดที่ {p.installmentNo}</div>
                  <div className="text-xs text-muted-foreground">
                    กำหนด: {new Date(p.dueDate).toLocaleDateString('th-TH')}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm">{Number(p.amountDue).toLocaleString()} ฿</div>
                  {Number(p.lateFee) > 0 && (
                    <div className="text-xs text-red-500">+ค่าปรับ {Number(p.lateFee).toLocaleString()} ฿</div>
                  )}
                  <span className={`px-2 py-0.5 rounded-full text-xs ${paymentStatusColors[p.status] || 'bg-muted text-muted-foreground'}`}>
                    {statusLabels[p.status] || p.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Receipts */}
        {data.receipts.length > 0 && (
          <div className="bg-card rounded-lg border border-border shadow-xs shadow-black/5">
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-sm font-semibold">ใบเสร็จรับเงิน</h3>
            </div>
            <div className="divide-y divide-border">
              {data.receipts.map((r, i) => (
                <div key={i} className="px-4 py-3 flex items-center justify-between">
                  <div>
                    <div className="text-xs font-mono">{r.receiptNumber}</div>
                    <div className="text-xs text-muted-foreground">{new Date(r.paidDate).toLocaleDateString('th-TH')}</div>
                  </div>
                  <div className="text-sm font-medium">{Number(r.amount).toLocaleString()} ฿</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Signatures */}
        {data.signatures.length > 0 && (
          <div className="bg-card rounded-lg border border-border p-4 shadow-xs shadow-black/5">
            <h3 className="text-sm font-semibold mb-2">การลงนาม</h3>
            <div className="grid grid-cols-2 gap-2">
              {data.signatures.map((s, i) => (
                <div key={i} className="text-xs p-2 bg-green-50 rounded">
                  <div className="font-medium">{s.signerName}</div>
                  <div className="text-muted-foreground">{s.signerType} - {new Date(s.signedAt).toLocaleDateString('th-TH')}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="text-center text-xs text-muted-foreground py-4">
          <p>เอกสารนี้สร้างโดยระบบ BESTCHOICE อัตโนมัติ</p>
          <p>ข้อมูล ณ วันที่ {new Date().toLocaleDateString('th-TH')}</p>
        </div>
      </div>
    </div>
  );
}

export default CustomerPortalPage;
