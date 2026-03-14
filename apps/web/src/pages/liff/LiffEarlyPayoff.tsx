import { useState, useEffect } from 'react';
import liff from '@line/liff';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

const API_BASE = import.meta.env.VITE_API_URL || '/api';
const LIFF_ID = import.meta.env.VITE_LIFF_ID || '';

interface EarlyPayoffQuote {
  remainingMonths: number;
  remainingPrincipal: number;
  remainingInterest: number;
  discount: number;
  partiallyPaidCredit: number;
  unpaidLateFees: number;
  totalPayoff: number;
  contractNumber: string;
  customerName: string;
  error?: string;
}

type View = 'loading' | 'quote' | 'creating' | 'error';

export default function LiffEarlyPayoff() {
  const [view, setView] = useState<View>('loading');
  const [quote, setQuote] = useState<EarlyPayoffQuote | null>(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [lineId, setLineId] = useState('');

  const params = new URLSearchParams(window.location.search);
  const contractId = params.get('contractId') || '';

  useEffect(() => {
    initLiff();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        await fetchQuote(profile.userId);
      } else {
        const qLineId = params.get('lineId') || '';
        if (qLineId && contractId) {
          setLineId(qLineId);
          await fetchQuote(qLineId);
        } else {
          setErrorMessage('ไม่สามารถระบุตัวตนได้ กรุณาเปิดผ่าน LINE');
          setView('error');
        }
      }
    } catch (err) {
      console.error('LIFF init error:', err);
      const qLineId = params.get('lineId') || '';
      if (qLineId && contractId) {
        setLineId(qLineId);
        await fetchQuote(qLineId);
      } else {
        setErrorMessage('ไม่สามารถเชื่อมต่อ LINE ได้');
        setView('error');
      }
    }
  }

  async function fetchQuote(id: string) {
    if (!contractId) {
      setErrorMessage('ไม่พบรหัสสัญญา');
      setView('error');
      return;
    }

    try {
      const res = await fetch(
        `${API_BASE}/line-oa/liff/early-payoff-quote?lineId=${encodeURIComponent(id)}&contractId=${encodeURIComponent(contractId)}`,
      );
      const result = await res.json();
      if (result.error) {
        setErrorMessage(result.error);
        setView('error');
        return;
      }
      setQuote(result);
      setView('quote');
    } catch {
      setErrorMessage('ไม่สามารถโหลดข้อมูลได้ กรุณาลองใหม่');
      setView('error');
    }
  }

  async function handlePayoff() {
    setView('creating');
    try {
      const res = await fetch(`${API_BASE}/line-oa/liff/early-payoff`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineId, contractId }),
      });
      const result = await res.json();
      if (result.url) {
        window.location.href = result.url;
      } else {
        setErrorMessage(result.error || 'ไม่สามารถสร้างลิงก์ชำระเงินได้');
        setView('error');
      }
    } catch {
      setErrorMessage('เกิดข้อผิดพลาด กรุณาลองใหม่');
      setView('error');
    }
  }

  // Loading
  if (view === 'loading') {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" />
      </div>
    );
  }

  // Error
  if (view === 'error') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <div className="text-destructive text-5xl mb-4">!</div>
            <h2 className="text-lg font-bold mb-2">ไม่สามารถดำเนินการได้</h2>
            <p className="text-muted-foreground text-sm mb-6">{errorMessage}</p>
            <Button variant="outline" asChild>
              <a href={`/liff/contract${lineId ? `?lineId=${encodeURIComponent(lineId)}` : ''}`}>
                กลับไปดูสัญญา
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Creating payment link
  if (view === 'creating') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto" />
          <p className="mt-4 text-muted-foreground">กำลังสร้างลิงก์ชำระเงิน...</p>
        </div>
      </div>
    );
  }

  // Quote view
  if (!quote) return null;

  return (
    <div className="min-h-screen bg-background p-4 pb-8">
      {/* Header */}
      <div className="bg-primary rounded-xl p-5 text-primary-foreground mb-4">
        <p className="text-xs opacity-80">BEST CHOICE</p>
        <h1 className="text-base font-bold mt-1">ปิดยอดก่อนกำหนด</h1>
        <p className="text-xs opacity-80 mt-1">สัญญา {quote.contractNumber}</p>
      </div>

      {/* Customer Info */}
      <Card className="mb-4">
        <CardContent className="py-4">
          <p className="text-sm text-muted-foreground">ลูกค้า</p>
          <p className="text-base font-medium">{quote.customerName}</p>
        </CardContent>
      </Card>

      {/* Quote Details */}
      <Card className="mb-4">
        <CardContent>
          <h2 className="text-sm font-bold mb-3">รายละเอียดยอดปิด</h2>
          <div className="space-y-2.5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">งวดคงเหลือ</span>
              <span className="font-medium">{quote.remainingMonths} งวด</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">เงินต้นคงเหลือ</span>
              <span className="font-medium">{quote.remainingPrincipal.toLocaleString()} บาท</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">ดอกเบี้ยคงเหลือ</span>
              <span className="font-medium">{quote.remainingInterest.toLocaleString()} บาท</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-success">ส่วนลดดอกเบี้ย (50%)</span>
              <span className="font-medium text-success">-{quote.discount.toLocaleString()} บาท</span>
            </div>
            {quote.partiallyPaidCredit > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-success">หักยอดชำระบางส่วน</span>
                <span className="font-medium text-success">-{quote.partiallyPaidCredit.toLocaleString()} บาท</span>
              </div>
            )}
            {quote.unpaidLateFees > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-destructive">ค่าปรับค้างชำระ</span>
                <span className="font-medium text-destructive">+{quote.unpaidLateFees.toLocaleString()} บาท</span>
              </div>
            )}

            <div className="border-t border-border pt-3 flex justify-between items-center">
              <span className="text-sm font-medium">ยอดปิดสัญญา</span>
              <div className="text-right">
                <span className="text-2xl font-bold text-primary">{quote.totalPayoff.toLocaleString()}</span>
                <span className="text-sm text-muted-foreground ml-1">บาท</span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Info Note */}
      <Card className="mb-4 border-primary/20 bg-primary/5">
        <CardContent className="py-3">
          <p className="text-xs text-muted-foreground">
            ยอดปิดสัญญาได้รับส่วนลดดอกเบี้ย 50% จากดอกเบี้ยคงเหลือ กดชำระเพื่อปิดสัญญาทันที
          </p>
        </CardContent>
      </Card>

      {/* Pay Button */}
      <Button
        variant="primary"
        size="lg"
        className="w-full"
        onClick={handlePayoff}
      >
        ชำระเพื่อปิดยอด {quote.totalPayoff.toLocaleString()} บาท
      </Button>

      {/* Back link */}
      <div className="text-center mt-4">
        <Button variant="ghost" className="text-muted-foreground" asChild>
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
