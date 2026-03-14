import { useState, useEffect } from 'react';
import liff from '@line/liff';
import { CreditCard, ChevronDown } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
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

const statusConfig: Record<string, { label: string; variant: 'success' | 'destructive' | 'secondary' | 'info' }> = {
  ACTIVE: { label: 'ปกติ', variant: 'success' },
  OVERDUE: { label: 'ค้างชำระ', variant: 'destructive' },
  COMPLETED: { label: 'ครบแล้ว', variant: 'secondary' },
  EARLY_PAYOFF: { label: 'ปิดก่อนกำหนด', variant: 'info' },
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
  const [lineId, setLineId] = useState('');
  const [creatingPayLink, setCreatingPayLink] = useState(false);

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
        await fetchContracts(profile.userId);
      } else {
        const params = new URLSearchParams(window.location.search);
        const qLineId = params.get('lineId');
        if (qLineId) {
          setLineId(qLineId);
          await fetchContracts(qLineId);
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
        await fetchContracts(qLineId);
      } else {
        setError('ไม่สามารถเชื่อมต่อ LINE ได้ กรุณาลองใหม่');
      }
    } finally {
      setLoading(false);
    }
  }

  async function fetchContracts(lineId: string) {
    try {
      const res = await fetch(`${API_BASE}/line-oa/liff/contracts?lineId=${encodeURIComponent(lineId)}`);
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

  // --- Loading ---
  if (loading) {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  // --- Error ---
  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <div className="text-destructive text-5xl mb-4">!</div>
            <h2 className="text-lg font-bold mb-2">ไม่สามารถดำเนินการได้</h2>
            <p className="text-muted-foreground text-sm">{error}</p>
            {error.includes('ลงทะเบียน') && (
              <Button variant="primary" size="lg" className="mt-6" asChild>
                <a href={`/liff/register${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>ลงทะเบียนเลย</a>
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- No contracts ---
  if (!data || data.contracts.length === 0) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <div className="text-muted-foreground text-5xl mb-4">📋</div>
            <h2 className="text-lg font-bold mb-2">ไม่มีสัญญา</h2>
            <p className="text-muted-foreground text-sm">
              คุณ{data?.customer.name} ยังไม่มีสัญญาที่ใช้งานอยู่
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const contract = data.contracts[selectedContract];
  const payments = contract.payments;
  const displayPayments = showAllPayments ? payments : payments.slice(0, 6);

  // Find next unpaid installment for "ชำระงวดถัดไป" button
  const nextUnpaid = payments.find((p) => p.status !== 'PAID');

  async function handlePayClick() {
    if (creatingPayLink) return;
    setCreatingPayLink(true);
    try {
      const res = await fetch(`${API_BASE}/line-oa/liff/create-payment-link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineId, contractId: contract.id }),
      });
      const result = await res.json();
      if (result.url) {
        window.location.href = result.url;
      } else {
        alert(result.error || 'ไม่สามารถสร้างลิงก์ชำระเงินได้');
      }
    } catch {
      alert('เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setCreatingPayLink(false);
    }
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-8">
      {/* Header */}
      <div className="bg-primary rounded-xl p-5 text-primary-foreground mb-4">
        <p className="text-xs opacity-80">BEST CHOICE</p>
        <h1 className="text-base font-bold mt-1">สัญญาของฉัน</h1>
        <p className="text-sm opacity-90 mt-1">คุณ{data.customer.name}</p>
      </div>

      {/* Contract Tabs (if multiple) */}
      {data.contracts.length > 1 && (
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {data.contracts.map((c, i) => (
            <Button
              key={c.id}
              variant={i === selectedContract ? 'primary' : 'outline'}
              size="sm"
              className="flex-shrink-0"
              onClick={() => { setSelectedContract(i); setShowAllPayments(false); }}
            >
              {c.contractNumber}
            </Button>
          ))}
        </div>
      )}

      {/* Contract Summary */}
      <Card className="mb-4">
        <CardContent>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold">{contract.contractNumber}</h2>
            <Badge
              variant={statusConfig[contract.status]?.variant || 'secondary'}
              appearance="light"
              size="sm"
            >
              {statusConfig[contract.status]?.label || contract.status}
            </Badge>
          </div>
          <p className="text-muted-foreground text-sm mb-3">{contract.product}</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted-foreground">ราคาสินค้า</p>
              <p className="text-sm font-medium">{contract.sellingPrice.toLocaleString()} บาท</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">เงินดาวน์</p>
              <p className="text-sm font-medium">{contract.downPayment.toLocaleString()} บาท</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">ชำระแล้ว</p>
              <p className="text-sm font-medium text-success">
                {contract.paidInstallments}/{contract.totalMonths} งวด
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">ยอดค้าง</p>
              <p className="text-sm font-bold text-destructive">
                {contract.totalOutstanding > 0
                  ? `${contract.totalOutstanding.toLocaleString()} บาท`
                  : 'ครบแล้ว'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Pay Next Installment CTA */}
      {nextUnpaid && contract.totalOutstanding > 0 && (
        <Card className="mb-4 border-primary/20 bg-primary/5">
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <p className="text-sm font-medium">งวดถัดไป: งวดที่ {nextUnpaid.installmentNo}</p>
              <p className="text-xs text-muted-foreground">
                ครบกำหนด{' '}
                {new Date(nextUnpaid.dueDate).toLocaleDateString('th-TH', {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </p>
            </div>
            <Button
              variant="primary"
              size="md"
              className="gap-1.5"
              onClick={handlePayClick}
              disabled={creatingPayLink}
            >
              <CreditCard className="size-4" />
              {creatingPayLink ? 'กำลังสร้าง...' : 'ชำระเงิน'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Payment Schedule */}
      <Card className="mb-4">
        <CardContent>
          <h2 className="text-sm font-bold mb-3">ตารางค่างวด</h2>
          <div className="space-y-2">
            {displayPayments.map((p) => {
              const dueDateStr = new Date(p.dueDate).toLocaleDateString('th-TH', {
                day: 'numeric',
                month: 'short',
              });
              const totalAmount = p.amountDue + p.lateFee;
              const isPaid = p.status === 'PAID';
              const isOverdue = p.status === 'OVERDUE';

              return (
                <div
                  key={p.installmentNo}
                  className={`flex items-center justify-between p-3 rounded-lg ${
                    isPaid
                      ? 'bg-success/5'
                      : isOverdue
                        ? 'bg-destructive/5'
                        : 'bg-muted/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-lg">{paymentStatusIcon[p.status] || '⬜'}</span>
                    <div>
                      <p className="text-sm font-medium">งวดที่ {p.installmentNo}</p>
                      <p className="text-xs text-muted-foreground">{dueDateStr}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p
                      className={`text-sm font-medium ${
                        isPaid ? 'text-success' : isOverdue ? 'text-destructive' : ''
                      }`}
                    >
                      {totalAmount.toLocaleString()} บาท
                    </p>
                    {isPaid && p.paidDate && (
                      <p className="text-xs text-muted-foreground">
                        {new Date(p.paidDate).toLocaleDateString('th-TH', {
                          day: 'numeric',
                          month: 'short',
                        })}
                      </p>
                    )}
                    {p.lateFee > 0 && !isPaid && (
                      <p className="text-xs text-destructive">ค่าปรับ {p.lateFee.toLocaleString()}</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {payments.length > 6 && !showAllPayments && (
            <Button
              variant="ghost"
              mode="link"
              className="w-full mt-3 text-primary"
              onClick={() => setShowAllPayments(true)}
            >
              ดูทั้งหมด ({payments.length} งวด)
              <ChevronDown className="size-4" />
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Navigation Links */}
      <Card className="mb-4">
        <CardContent className="py-3 space-y-2">
          <Button variant="outline" size="md" className="w-full" asChild>
            <a href={`/liff/history${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
              ประวัติชำระเงิน
            </a>
          </Button>
          <Button variant="outline" size="md" className="w-full" asChild>
            <a href={`/liff/profile${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
              โปรไฟล์ของฉัน
            </a>
          </Button>
        </CardContent>
      </Card>

      {/* Legend */}
      <div className="text-center text-xs text-muted-foreground space-x-3 mb-4">
        <span>✅ ชำระแล้ว</span>
        <span>⬜ รอชำระ</span>
        <span>❌ ค้างชำระ</span>
        <span>⏳ บางส่วน</span>
      </div>

      <p className="text-center text-xs text-muted-foreground">
        BEST CHOICE - ระบบผ่อนชำระมือถือ
      </p>
    </div>
  );
}
