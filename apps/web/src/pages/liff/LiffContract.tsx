import { useState, useEffect } from 'react';
import liff from '@line/liff';

const API_BASE = import.meta.env.VITE_API_URL || '';
const LIFF_ID = import.meta.env.VITE_LIFF_ID || '';

interface Payment {
  installmentNo: number;
  dueDate: string;
  amountDue: number;
  amountPaid: number;
  lateFee: number;
  status: string;
  paidDate: string | null;
  paymentMethod: string | null;
}

interface Contract {
  id: string;
  contractNumber: string;
  status: string;
  product: string;
  sellingPrice: number;
  downPayment: number;
  totalMonths: number;
  paidInstallments: number;
  totalOutstanding: number;
  createdAt: string;
  payments: Payment[];
}

interface ContractData {
  customer: { name: string };
  contracts: Contract[];
}

const statusLabel: Record<string, string> = {
  ACTIVE: 'ปกติ',
  OVERDUE: 'ค้างชำระ',
  COMPLETED: 'ครบแล้ว',
  EARLY_PAYOFF: 'ปิดก่อนกำหนด',
};

const statusColor: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-700',
  OVERDUE: 'bg-red-100 text-red-700',
  COMPLETED: 'bg-gray-100 text-gray-600',
  EARLY_PAYOFF: 'bg-blue-100 text-blue-700',
};

const paymentStatusIcon: Record<string, string> = {
  PAID: '✅',
  OVERDUE: '❌',
  PARTIALLY_PAID: '⏳',
  PENDING: '⬜',
};

export default function LiffContract() {
  const [data, setData] = useState<ContractData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedContract, setSelectedContract] = useState(0);
  const [showAllPayments, setShowAllPayments] = useState(false);

  useEffect(() => {
    initLiff();
  }, []);

  async function initLiff() {
    try {
      if (LIFF_ID) {
        await liff.init({ liffId: LIFF_ID });

        if (!liff.isLoggedIn()) {
          liff.login();
          return;
        }

        const profile = await liff.getProfile();
        await fetchContracts(profile.userId);
      } else {
        // Dev fallback: use URL param
        const params = new URLSearchParams(window.location.search);
        const lineId = params.get('lineId');
        if (lineId) {
          await fetchContracts(lineId);
        } else {
          setError('ไม่สามารถระบุตัวตนได้ กรุณาเปิดผ่าน LINE');
        }
      }
    } catch (err) {
      console.error('LIFF init error:', err);
      // Fallback for dev
      const params = new URLSearchParams(window.location.search);
      const lineId = params.get('lineId');
      if (lineId) {
        await fetchContracts(lineId);
      } else {
        setError('ไม่สามารถเชื่อมต่อ LINE ได้ กรุณาลองใหม่');
      }
    } finally {
      setLoading(false);
    }
  }

  async function fetchContracts(lineId: string) {
    try {
      const res = await fetch(`${API_BASE}/api/line-oa/liff/contracts?lineId=${encodeURIComponent(lineId)}`);
      if (res.status === 404) {
        setError('ยังไม่ได้ลงทะเบียน กรุณาลงทะเบียนก่อน');
        return;
      }
      if (!res.ok) throw new Error('API error');
      const result = await res.json();
      setData(result);
    } catch {
      setError('ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่');
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mx-auto" />
          <p className="mt-4 text-gray-600">กำลังโหลดข้อมูลสัญญา...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-red-500 text-5xl mb-4">!</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">ไม่สามารถดำเนินการได้</h2>
          <p className="text-gray-600">{error}</p>
          {error.includes('ลงทะเบียน') && (
            <a
              href="/liff/register"
              className="mt-4 inline-block bg-green-600 text-white px-6 py-3 rounded-xl font-medium"
            >
              ลงทะเบียนเลย
            </a>
          )}
        </div>
      </div>
    );
  }

  if (!data || data.contracts.length === 0) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-gray-400 text-5xl mb-4">📋</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">ไม่มีสัญญา</h2>
          <p className="text-gray-600">คุณ{data?.customer.name} ยังไม่มีสัญญาที่ใช้งานอยู่</p>
        </div>
      </div>
    );
  }

  const contract = data.contracts[selectedContract];
  const payments = contract.payments;
  const displayPayments = showAllPayments ? payments : payments.slice(0, 6);

  return (
    <div className="min-h-screen bg-gray-50 p-4 pb-8">
      {/* Header */}
      <div className="bg-green-600 rounded-2xl p-6 text-white mb-4">
        <p className="text-xs opacity-80">BEST CHOICE</p>
        <h1 className="text-lg font-bold mt-1">สัญญาของฉัน</h1>
        <p className="text-sm opacity-90 mt-1">คุณ{data.customer.name}</p>
      </div>

      {/* Contract Tabs (if multiple) */}
      {data.contracts.length > 1 && (
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {data.contracts.map((c, i) => (
            <button
              key={c.id}
              onClick={() => { setSelectedContract(i); setShowAllPayments(false); }}
              className={`flex-shrink-0 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                i === selectedContract
                  ? 'bg-green-600 text-white'
                  : 'bg-white text-gray-600 border'
              }`}
            >
              {c.contractNumber}
            </button>
          ))}
        </div>
      )}

      {/* Contract Summary */}
      <div className="bg-white rounded-2xl shadow-sm p-5 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-gray-800">{contract.contractNumber}</h2>
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${statusColor[contract.status] || 'bg-gray-100'}`}>
            {statusLabel[contract.status] || contract.status}
          </span>
        </div>
        <p className="text-gray-600 text-sm mb-3">{contract.product}</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-gray-400">ราคาสินค้า</p>
            <p className="text-sm font-medium">{contract.sellingPrice.toLocaleString()} บาท</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">เงินดาวน์</p>
            <p className="text-sm font-medium">{contract.downPayment.toLocaleString()} บาท</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">ชำระแล้ว</p>
            <p className="text-sm font-medium text-green-600">{contract.paidInstallments}/{contract.totalMonths} งวด</p>
          </div>
          <div>
            <p className="text-xs text-gray-400">ยอดค้าง</p>
            <p className="text-sm font-bold text-red-600">
              {contract.totalOutstanding > 0 ? `${contract.totalOutstanding.toLocaleString()} บาท` : 'ครบแล้ว'}
            </p>
          </div>
        </div>
      </div>

      {/* Payment Schedule */}
      <div className="bg-white rounded-2xl shadow-sm p-5 mb-4">
        <h2 className="text-sm font-bold text-gray-800 mb-3">ตารางค่างวด</h2>
        <div className="space-y-2">
          {displayPayments.map((p) => {
            const dueDate = new Date(p.dueDate).toLocaleDateString('th-TH', {
              day: 'numeric',
              month: 'short',
            });
            const amount = p.amountDue + p.lateFee;
            const isPaid = p.status === 'PAID';
            const isOverdue = p.status === 'OVERDUE';

            return (
              <div
                key={p.installmentNo}
                className={`flex items-center justify-between p-3 rounded-xl ${
                  isPaid ? 'bg-green-50' : isOverdue ? 'bg-red-50' : 'bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-lg">{paymentStatusIcon[p.status] || '⬜'}</span>
                  <div>
                    <p className="text-sm font-medium">งวดที่ {p.installmentNo}</p>
                    <p className="text-xs text-gray-400">{dueDate}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-medium ${isPaid ? 'text-green-600' : isOverdue ? 'text-red-600' : 'text-gray-700'}`}>
                    {amount.toLocaleString()} บาท
                  </p>
                  {isPaid && p.paidDate && (
                    <p className="text-xs text-gray-400">
                      {new Date(p.paidDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })}
                    </p>
                  )}
                  {p.lateFee > 0 && !isPaid && (
                    <p className="text-xs text-red-500">ค่าปรับ {p.lateFee.toLocaleString()}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {payments.length > 6 && !showAllPayments && (
          <button
            onClick={() => setShowAllPayments(true)}
            className="w-full mt-3 text-center text-sm text-green-600 font-medium py-2"
          >
            ดูทั้งหมด ({payments.length} งวด)
          </button>
        )}
      </div>

      {/* Legend */}
      <div className="text-center text-xs text-gray-400 space-x-3 mb-4">
        <span>✅ ชำระแล้ว</span>
        <span>⬜ รอชำระ</span>
        <span>❌ ค้างชำระ</span>
        <span>⏳ บางส่วน</span>
      </div>

      <p className="text-center text-xs text-gray-400">
        BEST CHOICE - ระบบผ่อนชำระมือถือ
      </p>
    </div>
  );
}
