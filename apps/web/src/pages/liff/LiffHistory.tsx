import { useState, useEffect } from 'react';
import liff from '@line/liff';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const LIFF_ID = import.meta.env.VITE_LIFF_ID || '';

interface HistoryPayment {
  contractNumber: string;
  installmentNo: number;
  amountPaid: number;
  paidDate: string;
  paymentMethod: string | null;
  lateFee: number;
}

interface HistoryData {
  customer: { name: string };
  payments: HistoryPayment[];
}

const methodLabels: Record<string, string> = {
  CASH: 'เงินสด',
  BANK_TRANSFER: 'โอนเงิน',
  PROMPTPAY: 'พร้อมเพย์',
  CREDIT_CARD: 'บัตรเครดิต',
  DEBIT_CARD: 'บัตรเดบิต',
};

export default function LiffHistory() {
  const [data, setData] = useState<HistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lineId, setLineId] = useState('');

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
        setLineId(profile.userId);
        await fetchHistory(profile.userId);
      } else {
        const params = new URLSearchParams(window.location.search);
        const qLineId = params.get('lineId');
        if (qLineId) {
          setLineId(qLineId);
          await fetchHistory(qLineId);
        } else {
          setError('ไม่สามารถระบุตัวตนได้ กรุณาเปิดผ่าน LINE');
        }
      }
    } catch (err) {
      console.error('LIFF init error:', err);
      const params = new URLSearchParams(window.location.search);
      const qLineId = params.get('lineId');
      if (qLineId) {
        setLineId(qLineId);
        await fetchHistory(qLineId);
      } else {
        setError('ไม่สามารถเชื่อมต่อ LINE ได้ กรุณาลองใหม่');
      }
    } finally {
      setLoading(false);
    }
  }

  async function fetchHistory(id: string) {
    try {
      const res = await fetch(`${API_BASE}/line-oa/liff/history?lineId=${encodeURIComponent(id)}`);
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
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <div className="text-destructive text-5xl mb-4">!</div>
            <h2 className="text-lg font-bold mb-2">ไม่สามารถดำเนินการได้</h2>
            <p className="text-muted-foreground text-sm">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!data || data.payments.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <div className="text-muted-foreground text-5xl mb-4">📋</div>
            <h2 className="text-lg font-bold mb-2">ยังไม่มีประวัติชำระ</h2>
            <p className="text-muted-foreground text-sm">ยังไม่มีรายการชำระเงินที่บันทึกแล้ว</p>
            <Button variant="primary" size="lg" className="mt-6" asChild>
              <a href={`/liff/contract${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
                กลับไปดูสัญญา
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const totalPaid = data.payments.reduce((sum, p) => sum + p.amountPaid, 0);

  return (
    <div className="min-h-screen bg-background p-4 pb-8">
      {/* Header */}
      <div className="bg-primary rounded-xl p-5 text-primary-foreground mb-4">
        <p className="text-xs opacity-80">BEST CHOICE</p>
        <h1 className="text-base font-bold mt-1">ประวัติชำระเงิน</h1>
        <p className="text-sm opacity-90 mt-1">คุณ{data.customer.name}</p>
      </div>

      {/* Summary */}
      <Card className="mb-4">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground">ชำระแล้วทั้งหมด</p>
              <p className="text-lg font-bold text-success">{totalPaid.toLocaleString()} บาท</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">จำนวนงวด</p>
              <p className="text-lg font-bold">{data.payments.length} งวด</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment List */}
      <Card className="mb-4">
        <CardContent>
          <h2 className="text-sm font-bold mb-3">รายการชำระ</h2>
          <div className="space-y-2">
            {data.payments.map((p, i) => (
              <div
                key={`${p.contractNumber}-${p.installmentNo}-${i}`}
                className="flex items-center justify-between p-3 rounded-lg bg-success/5"
              >
                <div>
                  <p className="text-sm font-medium">
                    ✅ งวดที่ {p.installmentNo}
                  </p>
                  <p className="text-xs text-muted-foreground">{p.contractNumber}</p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(p.paidDate).toLocaleDateString('th-TH', {
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                    })}
                    {p.paymentMethod && ` · ${methodLabels[p.paymentMethod] || p.paymentMethod}`}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-medium text-success">
                    {p.amountPaid.toLocaleString()} บาท
                  </p>
                  {p.lateFee > 0 && (
                    <p className="text-xs text-destructive">ค่าปรับ {p.lateFee.toLocaleString()}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Back link */}
      <div className="text-center">
        <Button variant="ghost" mode="link" className="text-primary" asChild>
          <a href={`/liff/contract${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
            ← กลับไปดูสัญญา
          </a>
        </Button>
      </div>

      <p className="text-center text-xs text-muted-foreground mt-4">
        BEST CHOICE - ระบบผ่อนชำระมือถือ
      </p>
    </div>
  );
}
