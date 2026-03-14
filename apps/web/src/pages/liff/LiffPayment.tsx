import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { CreditCard, QrCode, Building2, CheckCircle2, AlertCircle, Upload, Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useMockPayment } from './useMockPayment';

const API_BASE = import.meta.env.VITE_API_URL || '/api';

interface PaymentLinkData {
  valid: boolean;
  token: string;
  amount: number;
  status: string;
  expiresAt: string;
  contract: {
    contractNumber: string;
    customer: { name: string };
  };
  payment: {
    installmentNo: number;
    amountDue: number;
    lateFee: number;
    dueDate: string;
  } | null;
  promptPay?: {
    qrDataUrl: string | null;
    accountName: string;
    maskedId: string;
  };
}

type View = 'loading' | 'select-method' | 'promptpay-pending' | 'success' | 'slip-uploaded' | 'error';

export default function LiffPayment() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PaymentLinkData | null>(null);
  const [view, setView] = useState<View>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [cardForm, setCardForm] = useState({ number: '', expiry: '', cvv: '', name: '' });

  const mock = useMockPayment();
  const queryLineId = new URLSearchParams(window.location.search).get('lineId') || '';

  // Fetch payment link data
  useEffect(() => {
    if (!token) {
      setErrorMessage('ลิงก์ไม่ถูกต้อง');
      setView('error');
      return;
    }

    fetch(`${API_BASE}/line-oa/pay/${token}`)
      .then((res) => res.json())
      .then((result) => {
        if (!result || result.status === 'EXPIRED') {
          setErrorMessage('ลิงก์ชำระเงินหมดอายุแล้ว กรุณาขอลิงก์ใหม่');
          setView('error');
        } else if (result.status === 'USED') {
          setErrorMessage('ลิงก์นี้ถูกใช้งานแล้ว');
          setView('error');
        } else if (result.valid) {
          setData(result);
          if (result.promptPay?.qrDataUrl) {
            setQrUrl(result.promptPay.qrDataUrl);
          }
          setView('select-method');
        } else {
          setErrorMessage(result.error || 'ลิงก์ไม่ถูกต้อง');
          setView('error');
        }
      })
      .catch(() => {
        setErrorMessage('ไม่สามารถโหลดข้อมูลได้');
        setView('error');
      });
  }, [token]);

  // Watch mock payment status → navigate to success
  useEffect(() => {
    if (mock.status === 'successful') {
      setView('success');
    }
  }, [mock.status]);

  const amount = data ? Number(data.amount) : 0;
  const payment = data?.payment;
  const lateFee = payment ? Number(payment.lateFee) : 0;
  const dueDate = payment ? new Date(payment.dueDate).toLocaleDateString('th-TH') : '-';

  // --- PromptPay handlers ---
  const handlePromptPayStart = () => {
    mock.createPromptPayCharge(amount);
    setView('promptpay-pending');
  };

  // --- Card handlers ---
  const handleCardPay = () => {
    if (!cardForm.number || !cardForm.expiry || !cardForm.cvv) return;
    mock.createCardCharge(amount, cardForm);
    // status watcher will navigate to success
  };

  // --- Slip upload handlers ---
  const handleSlipUpload = async () => {
    if (!slipFile || !data) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('slip', slipFile);
      formData.append('contractId', data.contract.contractNumber);
      formData.append('token', data.token);

      const res = await fetch(`${API_BASE}/line-oa/slip-upload`, {
        method: 'POST',
        body: formData,
      });

      if (res.ok) {
        setView('slip-uploaded');
      } else {
        const err = await res.json();
        alert(err.message || 'อัปโหลดสลิปไม่สำเร็จ');
      }
    } catch {
      alert('เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setUploading(false);
    }
  };

  // ═══════════════════════════════════════════
  // VIEWS
  // ═══════════════════════════════════════════

  // --- Loading ---
  if (view === 'loading') {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }

  // --- Error ---
  if (view === 'error') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <AlertCircle className="size-16 text-destructive mx-auto mb-4" />
            <h2 className="text-lg font-bold mb-2">ไม่สามารถดำเนินการได้</h2>
            <p className="text-muted-foreground text-sm">{errorMessage}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- Slip uploaded ---
  if (view === 'slip-uploaded') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <CheckCircle2 className="size-16 text-success mx-auto mb-4" />
            <h2 className="text-lg font-bold mb-2">รับสลิปเรียบร้อย</h2>
            <p className="text-muted-foreground text-sm mb-6">
              กำลังตรวจสอบ จะแจ้งผลให้ทราบผ่าน LINE
            </p>
            <p className="text-xs text-muted-foreground">สามารถปิดหน้านี้ได้เลย</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- Success ---
  if (view === 'success') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <div className="size-20 rounded-full bg-success/10 flex items-center justify-center mx-auto mb-4">
              <CheckCircle2 className="size-12 text-success" />
            </div>
            <h2 className="text-xl font-bold mb-1">ชำระเงินสำเร็จ!</h2>
            <p className="text-muted-foreground text-sm mb-6">ระบบบันทึกการชำระเรียบร้อยแล้ว</p>

            <div className="bg-muted/50 rounded-lg p-4 text-left space-y-2 mb-6">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">สัญญา</span>
                <span className="font-medium">{data?.contract.contractNumber}</span>
              </div>
              {payment && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">งวดที่</span>
                  <span className="font-medium">{payment.installmentNo}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">ยอดชำระ</span>
                <span className="font-semibold text-success">{amount.toLocaleString()} บาท</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">วิธีชำระ</span>
                <span className="font-medium">
                  {mock.charge?.method === 'card' ? 'บัตรเครดิต' : 'PromptPay'}
                </span>
              </div>
              {mock.charge?.transactionRef && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">เลขอ้างอิง</span>
                  <span className="font-mono text-xs">{mock.charge.transactionRef}</span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Button variant="outline" size="lg" className="w-full" asChild>
                <a href={`/liff/contract${queryLineId ? `?lineId=${encodeURIComponent(queryLineId)}` : ''}`}>ดูสัญญาของฉัน</a>
              </Button>
              <Button variant="ghost" size="lg" className="w-full text-muted-foreground">
                ปิดหน้านี้
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- PromptPay Pending (QR + Polling) ---
  if (view === 'promptpay-pending') {
    return (
      <div className="min-h-screen bg-background p-4">
        {/* Header */}
        <div className="bg-primary rounded-xl p-5 text-primary-foreground mb-4">
          <p className="text-xs opacity-80">BEST CHOICE</p>
          <h1 className="text-base font-bold mt-1">รอการชำระเงิน</h1>
        </div>

        <Card className="mb-4">
          <CardContent className="text-center py-6">
            {/* QR Code */}
            {mock.charge?.qrCodeUrl && (
              <img
                src={mock.charge.qrCodeUrl}
                alt="PromptPay QR"
                className="mx-auto w-56 h-56 rounded-lg border mb-4"
              />
            )}

            <p className="text-sm font-medium mb-1">
              สแกนเพื่อชำระ{' '}
              <span className="text-primary font-bold">{amount.toLocaleString()} บาท</span>
            </p>

            {/* Polling indicator */}
            <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm mt-3">
              <Loader2 className="size-4 animate-spin" />
              <span>รอการยืนยันจากธนาคาร...</span>
            </div>

            {/* Countdown */}
            {mock.secondsLeft > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                หมดอายุใน {mock.formatCountdown(mock.secondsLeft)} นาที
              </p>
            )}

            {/* Mock simulate button (dev only) */}
            {import.meta.env.DEV && (
              <div className="mt-6 pt-4 border-t border-dashed">
                <p className="text-xs text-muted-foreground mb-2">[ Dev Mode ]</p>
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  onClick={mock.simulateSuccess}
                >
                  จำลองจ่ายสำเร็จ
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="text-center">
          <Button variant="ghost" className="text-muted-foreground" onClick={() => { mock.cancel(); setView('select-method'); }}>
            ยกเลิก
          </Button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // MAIN VIEW: Select Payment Method
  // ═══════════════════════════════════════════
  if (!data) return null;

  return (
    <div className="min-h-screen bg-background p-4 pb-8">
      {/* Header */}
      <div className="bg-primary rounded-xl p-5 text-primary-foreground mb-4">
        <p className="text-xs opacity-80">BEST CHOICE</p>
        <h1 className="text-base font-bold mt-1">ชำระเงินค่างวด</h1>
        <p className="text-xs opacity-80 mt-1">สัญญา {data.contract.contractNumber}</p>
      </div>

      {/* Payment Details Card */}
      <Card className="mb-4">
        <CardContent>
          <h2 className="text-xs text-muted-foreground font-medium mb-3">รายละเอียด</h2>
          <div className="space-y-2.5">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">ลูกค้า</span>
              <span className="font-medium">{data.contract.customer.name}</span>
            </div>
            {payment && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">งวดที่</span>
                <span className="font-medium">{payment.installmentNo}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">ครบกำหนด</span>
              <span className="font-medium">{dueDate}</span>
            </div>

            <div className="border-t border-border pt-3 flex justify-between items-center">
              <span className="text-muted-foreground text-sm">ยอดชำระ</span>
              <div className="text-right">
                <span className="text-2xl font-bold text-primary">{amount.toLocaleString()}</span>
                <span className="text-sm text-muted-foreground ml-1">บาท</span>
              </div>
            </div>
            {lateFee > 0 && (
              <div className="flex justify-end">
                <Badge variant="destructive" appearance="light" size="sm">
                  รวมค่าปรับ {lateFee.toLocaleString()} บาท
                </Badge>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Payment Method Tabs */}
      <Card>
        <CardContent>
          <h2 className="text-xs text-muted-foreground font-medium mb-3">เลือกวิธีชำระเงิน</h2>

          <Tabs defaultValue="promptpay">
            <TabsList variant="default" className="w-full mb-4" size="sm">
              <TabsTrigger value="promptpay" className="flex-1 gap-1.5">
                <QrCode className="size-3.5" />
                PromptPay
              </TabsTrigger>
              <TabsTrigger value="card" className="flex-1 gap-1.5">
                <CreditCard className="size-3.5" />
                บัตรเครดิต
              </TabsTrigger>
              <TabsTrigger value="transfer" className="flex-1 gap-1.5">
                <Building2 className="size-3.5" />
                โอนเอง
              </TabsTrigger>
            </TabsList>

            {/* ── Tab: PromptPay (Omise) ── */}
            <TabsContent value="promptpay">
              <div className="text-center py-2">
                <div className="bg-muted/50 rounded-lg p-6 mb-4">
                  <QrCode className="size-16 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground mb-1">
                    กดปุ่มด้านล่างเพื่อสร้าง QR Code
                  </p>
                  <p className="text-xs text-muted-foreground">
                    ระบบจะยืนยันการชำระอัตโนมัติ ไม่ต้องส่งสลิป
                  </p>
                </div>
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  onClick={handlePromptPayStart}
                >
                  ชำระผ่าน PromptPay {amount.toLocaleString()} บาท
                </Button>
              </div>
            </TabsContent>

            {/* ── Tab: Credit/Debit Card ── */}
            <TabsContent value="card">
              <div className="space-y-3 py-2">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">เลขบัตร</label>
                  <input
                    type="text"
                    placeholder="0000 0000 0000 0000"
                    maxLength={19}
                    className="w-full h-10 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring"
                    value={cardForm.number}
                    onChange={(e) => setCardForm({ ...cardForm, number: e.target.value })}
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">หมดอายุ</label>
                    <input
                      type="text"
                      placeholder="MM/YY"
                      maxLength={5}
                      className="w-full h-10 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring"
                      value={cardForm.expiry}
                      onChange={(e) => setCardForm({ ...cardForm, expiry: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">CVV</label>
                    <input
                      type="text"
                      placeholder="000"
                      maxLength={3}
                      className="w-full h-10 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring"
                      value={cardForm.cvv}
                      onChange={(e) => setCardForm({ ...cardForm, cvv: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">ชื่อบนบัตร</label>
                  <input
                    type="text"
                    placeholder="SOMCHAI JAIDEE"
                    className="w-full h-10 px-3 text-sm rounded-md border border-input bg-background focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring"
                    value={cardForm.name}
                    onChange={(e) => setCardForm({ ...cardForm, name: e.target.value })}
                  />
                </div>
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full mt-2"
                  onClick={handleCardPay}
                  disabled={!cardForm.number || !cardForm.expiry || !cardForm.cvv}
                >
                  ชำระเงิน {amount.toLocaleString()} บาท
                </Button>
                <p className="text-xs text-muted-foreground text-center mt-1">
                  ข้อมูลบัตรจะถูกเข้ารหัสอย่างปลอดภัย
                </p>
              </div>
            </TabsContent>

            {/* ── Tab: Manual Transfer + Slip ── */}
            <TabsContent value="transfer">
              <div className="py-2">
                {/* PromptPay QR + Account Info */}
                {qrUrl && (
                  <div className="text-center mb-4">
                    <img
                      src={qrUrl}
                      alt="PromptPay QR Code"
                      className="mx-auto w-48 h-48 rounded-lg border"
                      onError={() => setQrUrl(null)}
                    />
                    <p className="text-sm font-medium mt-3">
                      สแกน QR แล้วโอนเงิน <span className="text-primary font-bold">{amount.toLocaleString()} บาท</span>
                    </p>
                  </div>
                )}
                {data?.promptPay && (
                  <div className="bg-muted/50 rounded-lg p-3 mb-4 text-sm space-y-1">
                    {data.promptPay.accountName && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">ชื่อบัญชี</span>
                        <span className="font-medium">{data.promptPay.accountName}</span>
                      </div>
                    )}
                    {data.promptPay.maskedId && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">PromptPay</span>
                        <span className="font-medium">{data.promptPay.maskedId}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">ยอดโอน</span>
                      <span className="font-bold text-primary">{amount.toLocaleString()} บาท</span>
                    </div>
                  </div>
                )}

                {/* Slip Upload */}
                <div className="border-t border-border pt-4">
                  <p className="text-xs text-muted-foreground mb-3">
                    โอนเงินเสร็จแล้ว? แนบรูปสลิปเพื่อแจ้งชำระ
                  </p>

                  <label className="block w-full border-2 border-dashed border-border rounded-lg p-5 text-center cursor-pointer hover:border-primary/40 transition-colors">
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => setSlipFile(e.target.files?.[0] || null)}
                    />
                    {slipFile ? (
                      <div className="flex items-center justify-center gap-2">
                        <CheckCircle2 className="size-5 text-success" />
                        <div>
                          <p className="text-sm font-medium text-success">เลือกไฟล์แล้ว</p>
                          <p className="text-xs text-muted-foreground mt-0.5">{slipFile.name}</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center gap-1.5">
                        <Upload className="size-8 text-muted-foreground/40" />
                        <p className="text-sm text-muted-foreground">แตะเพื่อเลือกรูปสลิป</p>
                        <p className="text-xs text-muted-foreground/60">รองรับ JPG, PNG</p>
                      </div>
                    )}
                  </label>

                  <Button
                    variant="primary"
                    size="lg"
                    className="w-full mt-3"
                    onClick={handleSlipUpload}
                    disabled={!slipFile || uploading}
                  >
                    {uploading ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        กำลังส่ง...
                      </>
                    ) : (
                      'แจ้งชำระเงิน'
                    )}
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Footer */}
      <p className="text-center text-xs text-muted-foreground mt-6">
        BEST CHOICE - ระบบผ่อนชำระมือถือ
      </p>
    </div>
  );
}
