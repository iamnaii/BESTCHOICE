import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import {
  CreditCard,
  QrCode,
  Building2,
  CheckCircle2,
  AlertCircle,
  Upload,
  Loader2,
  RefreshCw,
  Clock,
  Timer,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { liffApi } from '@/lib/api';

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

interface PaymentIntentResult {
  success: boolean;
  paymentId: string;
  paymentUrl: string;
  gatewayRef: string;
  qrCodeUrl?: string;
}

interface PaymentStatusResult {
  paymentId: string;
  status: 'PENDING' | 'PAID' | 'FAILED';
  gatewayRef?: string;
  gatewayStatus?: string;
  amount: number;
  paidAt?: string;
}

type View =
  | 'loading'
  | 'select-method'
  | 'promptpay-pending'
  | 'gateway-pending'
  | 'success'
  | 'failed'
  | 'timeout'
  | 'slip-uploaded'
  | 'error';

const PAYMENT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export default function LiffPayment() {
  const { token } = useParams<{ token: string }>();
  const [view, setView] = useState<View>('loading');
  const [errorMessage, setErrorMessage] = useState('');
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [activePaymentId, setActivePaymentId] = useState<string | null>(null);
  const [gatewayRef, setGatewayRef] = useState<string | null>(null);

  const queryLineId = new URLSearchParams(window.location.search).get('lineId') || '';
  const pollingStartRef = useRef<number | null>(null);
  const [remainingTime, setRemainingTime] = useState<number>(PAYMENT_TIMEOUT_MS);

  // ─── Fetch payment link data ───
  const { data } = useQuery<PaymentLinkData | null>({
    queryKey: ['liff-payment', token],
    queryFn: async () => {
      const { data: result } = await liffApi.get(`/line-oa/pay/${token}`);
      if (!result || result.status === 'EXPIRED') {
        setErrorMessage('ลิงก์ชำระเงินหมดอายุแล้ว กรุณาขอลิงก์ใหม่');
        setView('error');
        return null;
      } else if (result.status === 'USED') {
        setErrorMessage('ลิงก์นี้ถูกใช้งานแล้ว');
        setView('error');
        return null;
      } else if (result.valid) {
        if (result.promptPay?.qrDataUrl) {
          setQrUrl(result.promptPay.qrDataUrl);
        }
        setView('select-method');
        return result;
      } else {
        setErrorMessage(result.error || 'ลิงก์ไม่ถูกต้อง');
        setView('error');
        return null;
      }
    },
    enabled: !!token,
  });

  // ─── Poll payment status (every 3s while PENDING, with 5-min timeout) ───
  const isPendingView = view === 'gateway-pending' || view === 'promptpay-pending';

  const { data: paymentStatus } = useQuery<PaymentStatusResult>({
    queryKey: ['payment-status', activePaymentId],
    queryFn: async () => {
      // Check timeout
      if (pollingStartRef.current) {
        const elapsed = Date.now() - pollingStartRef.current;
        if (elapsed >= PAYMENT_TIMEOUT_MS) {
          setView('timeout');
          throw new Error('timeout');
        }
      }
      const { data: result } = await liffApi.get(
        `/paysolutions/status/${activePaymentId}`,
      );
      return result;
    },
    enabled: !!activePaymentId && isPendingView,
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
    retry: false,
  });

  // Countdown timer
  useEffect(() => {
    if (!isPendingView || !pollingStartRef.current) return;

    const interval = setInterval(() => {
      const elapsed = Date.now() - (pollingStartRef.current || Date.now());
      const remaining = Math.max(0, PAYMENT_TIMEOUT_MS - elapsed);
      setRemainingTime(remaining);

      if (remaining <= 0) {
        setView('timeout');
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isPendingView]);

  // Watch payment status changes
  useEffect(() => {
    if (!paymentStatus) return;
    if (paymentStatus.status === 'PAID') {
      setView('success');
      toast.success('ชำระเงินสำเร็จ!');
    } else if (paymentStatus.status === 'FAILED') {
      setView('failed');
    }
  }, [paymentStatus]);

  // ─── Generate PromptPay QR mutation ───
  const generateQrMutation = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error('ไม่พบข้อมูลการชำระเงิน');
      const { data: result } = await liffApi.post(
        `/paysolutions/${data.contract.contractNumber}/generate-qr`,
        {
          amount: Number(data.amount),
          installmentNo: data.payment?.installmentNo,
        },
      );
      return result;
    },
    onSuccess: (result) => {
      setQrUrl(result.qrDataUrl);
      setActivePaymentId(result.paymentRef);
      pollingStartRef.current = Date.now();
      setRemainingTime(PAYMENT_TIMEOUT_MS);
      setView('promptpay-pending');
    },
    onError: (err: Error) => {
      toast.error(err.message || 'ไม่สามารถสร้าง QR ได้ กรุณาลองใหม่');
    },
  });

  // ─── Create payment intent mutation ───
  const createIntentMutation = useMutation({
    mutationFn: async () => {
      if (!data) throw new Error('ไม่พบข้อมูลการชำระเงิน');
      const payload = {
        contractId: data.contract.contractNumber,
        amount: Number(data.amount),
        description: `ชำระค่างวด สัญญา ${data.contract.contractNumber}`,
        lineId: queryLineId || undefined,
        installmentNo: data.payment?.installmentNo,
      };
      const { data: result } = await liffApi.post<PaymentIntentResult>(
        '/paysolutions/create-intent',
        payload,
      );
      return result;
    },
    onSuccess: (result) => {
      setActivePaymentId(result.paymentId);
      setGatewayRef(result.gatewayRef);
      pollingStartRef.current = Date.now();
      setRemainingTime(PAYMENT_TIMEOUT_MS);

      if (result.paymentUrl) {
        // Redirect to Pay Solutions payment page
        setView('gateway-pending');
        window.location.href = result.paymentUrl;
      } else {
        toast.error('ไม่ได้รับลิงก์ชำระเงิน กรุณาลองใหม่');
      }
    },
    onError: (err: Error) => {
      toast.error(err.message || 'ไม่สามารถสร้างรายการชำระเงินได้');
    },
  });

  // ─── Slip upload mutation (manual transfer) ───
  const slipMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!data) throw new Error('ไม่พบข้อมูลการชำระเงิน');
      const formData = new FormData();
      formData.append('slip', file);
      formData.append('contractId', data.contract.contractNumber);
      formData.append('token', data.token);

      const { data: result } = await liffApi
        .post('/line-oa/slip-upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
        .catch((err) => {
          const errData = err.response?.data || {};
          throw new Error(errData.error || errData.message || 'อัปโหลดสลิปไม่สำเร็จ');
        });
      return result;
    },
    onSuccess: () => {
      setView('slip-uploaded');
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  // No token
  useEffect(() => {
    if (!token) {
      setErrorMessage('ลิงก์ไม่ถูกต้อง');
      setView('error');
    }
  }, [token]);

  const amount = data ? Number(data.amount) : 0;
  const payment = data?.payment;
  const lateFee = payment ? Number(payment.lateFee) : 0;
  const dueDate = payment ? new Date(payment.dueDate).toLocaleDateString('th-TH') : '-';

  // ─── Handlers ───
  const handlePromptPayQr = () => {
    generateQrMutation.mutate();
  };

  const handleGatewayPay = () => {
    createIntentMutation.mutate();
  };

  const handleSlipUpload = () => {
    if (!slipFile) return;
    slipMutation.mutate(slipFile);
  };

  const handleRetry = () => {
    setActivePaymentId(null);
    setGatewayRef(null);
    pollingStartRef.current = null;
    setRemainingTime(PAYMENT_TIMEOUT_MS);
    setView('select-method');
  };

  const formatTime = useCallback((ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }, []);

  // =============================================
  // VIEWS
  // =============================================

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

  // --- Payment Failed ---
  if (view === 'failed') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <AlertCircle className="size-16 text-destructive mx-auto mb-4" />
            <h2 className="text-lg font-bold mb-2">การชำระเงินไม่สำเร็จ</h2>
            <p className="text-muted-foreground text-sm mb-6">
              ระบบไม่สามารถดำเนินการชำระเงินได้ กรุณาลองอีกครั้ง
            </p>
            {gatewayRef && (
              <p className="text-xs text-muted-foreground mb-4">
                เลขอ้างอิง: <span className="font-mono">{gatewayRef}</span>
              </p>
            )}
            <div className="space-y-2">
              <Button variant="primary" size="lg" className="w-full" onClick={handleRetry}>
                <RefreshCw className="size-4 mr-2" />
                ลองอีกครั้ง
              </Button>
              <Button variant="ghost" size="lg" className="w-full text-muted-foreground" asChild>
                <a
                  href={`/liff/contract${queryLineId ? `?lineId=${encodeURIComponent(queryLineId)}` : ''}`}
                >
                  กลับหน้าสัญญา
                </a>
              </Button>
            </div>
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
            <p className="text-muted-foreground text-sm mb-6">
              ระบบบันทึกการชำระเรียบร้อยแล้ว
            </p>

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
                <span className="font-semibold text-success">
                  {amount.toLocaleString()} บาท
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">วิธีชำระ</span>
                <span className="font-medium">ชำระออนไลน์</span>
              </div>
              {gatewayRef && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">เลขอ้างอิง</span>
                  <span className="font-mono text-xs">{gatewayRef}</span>
                </div>
              )}
              {paymentStatus?.paidAt && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">เวลา</span>
                  <span className="font-medium">
                    {new Date(paymentStatus.paidAt).toLocaleString('th-TH')}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Button variant="outline" size="lg" className="w-full" asChild>
                <a
                  href={`/liff/contract${queryLineId ? `?lineId=${encodeURIComponent(queryLineId)}` : ''}`}
                >
                  ดูสัญญาของฉัน
                </a>
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

  // --- Timeout ---
  if (view === 'timeout') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <Timer className="size-16 text-warning mx-auto mb-4" />
            <h2 className="text-lg font-bold mb-2">หมดเวลาชำระเงิน</h2>
            <p className="text-muted-foreground text-sm mb-2">
              ไม่ได้รับการยืนยันชำระเงินภายใน 5 นาที
            </p>
            <p className="text-muted-foreground text-xs mb-6">
              หากคุณชำระเงินแล้ว ระบบจะตรวจสอบและแจ้งผลให้ทราบผ่าน LINE
            </p>
            <div className="space-y-2">
              <Button variant="primary" size="lg" className="w-full" onClick={handleRetry}>
                <RefreshCw className="size-4 mr-2" />
                ลองอีกครั้ง
              </Button>
              <Button variant="ghost" size="lg" className="w-full text-muted-foreground" asChild>
                <a
                  href={`/liff/contract${queryLineId ? `?lineId=${encodeURIComponent(queryLineId)}` : ''}`}
                >
                  กลับหน้าสัญญา
                </a>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // --- PromptPay QR Pending (waiting for transfer confirmation) ---
  if (view === 'promptpay-pending') {
    return (
      <div className="min-h-screen bg-background p-4">
        {/* Header */}
        <div className="bg-primary rounded-xl p-5 text-primary-foreground mb-4">
          <p className="text-xs opacity-80">BEST CHOICE</p>
          <h1 className="text-base font-bold mt-1">สแกน QR ชำระเงิน</h1>
        </div>

        <Card className="mb-4">
          <CardContent className="text-center py-6">
            {/* Countdown Timer */}
            <div className="flex items-center justify-center gap-2 mb-4">
              <Clock className="size-4 text-warning" />
              <span className={`text-sm font-mono font-bold ${remainingTime <= 60000 ? 'text-destructive' : 'text-warning'}`}>
                เหลือเวลา {formatTime(remainingTime)}
              </span>
            </div>

            {/* QR Code */}
            {qrUrl && (
              <div className="mb-4">
                <img
                  src={qrUrl}
                  alt="PromptPay QR Code"
                  className="mx-auto w-56 h-56 rounded-lg border-2 border-primary/20"
                />
              </div>
            )}

            <p className="text-sm font-medium mb-1">
              สแกน QR แล้วโอนเงิน{' '}
              <span className="text-primary font-bold">{amount.toLocaleString()} บาท</span>
            </p>

            {data?.promptPay && (
              <div className="bg-muted/50 rounded-lg p-3 mt-3 text-sm space-y-1 text-left">
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

            <p className="text-xs text-muted-foreground mt-4">
              หลังโอนเงินแล้ว กรุณารอสักครู่ ระบบกำลังตรวจสอบ
            </p>

            {/* Polling indicator */}
            <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm mt-3">
              <div className="size-2 rounded-full bg-primary animate-pulse" />
              <span>กำลังตรวจสอบสถานะอัตโนมัติ...</span>
            </div>
          </CardContent>
        </Card>

        <div className="text-center space-y-2">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => {
              // Switch to slip upload instead
              handleRetry();
            }}
          >
            <Upload className="size-4 mr-2" />
            แนบสลิปแทน
          </Button>
          <Button
            variant="ghost"
            className="text-muted-foreground"
            onClick={handleRetry}
          >
            ยกเลิกและเลือกวิธีอื่น
          </Button>
        </div>
      </div>
    );
  }

  // --- Gateway Pending (waiting for Pay Solutions callback) ---
  if (view === 'gateway-pending') {
    return (
      <div className="min-h-screen bg-background p-4">
        {/* Header */}
        <div className="bg-primary rounded-xl p-5 text-primary-foreground mb-4">
          <p className="text-xs opacity-80">BEST CHOICE</p>
          <h1 className="text-base font-bold mt-1">รอการชำระเงิน</h1>
        </div>

        <Card className="mb-4">
          <CardContent className="text-center py-8">
            <Loader2 className="size-12 text-primary animate-spin mx-auto mb-4" />

            <h2 className="text-lg font-bold mb-2">กำลังรอการชำระเงิน...</h2>

            {/* Countdown Timer */}
            <div className="flex items-center justify-center gap-2 mb-3">
              <Clock className="size-4 text-warning" />
              <span className={`text-sm font-mono font-bold ${remainingTime <= 60000 ? 'text-destructive' : 'text-warning'}`}>
                เหลือเวลา {formatTime(remainingTime)}
              </span>
            </div>

            <p className="text-sm text-muted-foreground mb-1">
              ยอดชำระ{' '}
              <span className="text-primary font-bold">{amount.toLocaleString()} บาท</span>
            </p>

            <p className="text-xs text-muted-foreground mt-4">
              หากชำระเงินแล้ว กรุณารอสักครู่ ระบบกำลังตรวจสอบ
            </p>

            {gatewayRef && (
              <p className="text-xs text-muted-foreground mt-2">
                เลขอ้างอิง: <span className="font-mono">{gatewayRef}</span>
              </p>
            )}

            {/* Polling indicator */}
            <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm mt-4">
              <div className="size-2 rounded-full bg-primary animate-pulse" />
              <span>กำลังตรวจสอบสถานะอัตโนมัติ...</span>
            </div>
          </CardContent>
        </Card>

        <div className="text-center">
          <Button
            variant="ghost"
            className="text-muted-foreground"
            onClick={handleRetry}
          >
            ยกเลิกและเลือกวิธีอื่น
          </Button>
        </div>
      </div>
    );
  }

  // =============================================
  // MAIN VIEW: Select Payment Method
  // =============================================
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
                <span className="text-2xl font-bold text-primary">
                  {amount.toLocaleString()}
                </span>
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
          <h2 className="text-xs text-muted-foreground font-medium mb-3">
            เลือกวิธีชำระเงิน
          </h2>

          <Tabs defaultValue="promptpay">
            <TabsList variant="default" className="w-full mb-4" size="sm">
              <TabsTrigger value="promptpay" className="flex-1 gap-1.5">
                <QrCode className="size-3.5" />
                PromptPay
              </TabsTrigger>
              <TabsTrigger value="gateway" className="flex-1 gap-1.5">
                <CreditCard className="size-3.5" />
                บัตร/อื่นๆ
              </TabsTrigger>
              <TabsTrigger value="transfer" className="flex-1 gap-1.5">
                <Building2 className="size-3.5" />
                โอนเอง
              </TabsTrigger>
            </TabsList>

            {/* -- Tab: PromptPay QR -- */}
            <TabsContent value="promptpay">
              <div className="text-center py-2">
                {qrUrl ? (
                  <div className="mb-4">
                    <img
                      src={qrUrl}
                      alt="PromptPay QR Code"
                      className="mx-auto w-48 h-48 rounded-lg border"
                      onError={() => setQrUrl(null)}
                    />
                    <p className="text-sm font-medium mt-3">
                      สแกน QR แล้วโอนเงิน{' '}
                      <span className="text-primary font-bold">
                        {amount.toLocaleString()} บาท
                      </span>
                    </p>
                    {data?.promptPay && (
                      <div className="bg-muted/50 rounded-lg p-3 mt-3 text-sm space-y-1 text-left">
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
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="bg-muted/50 rounded-lg p-6 mb-4">
                    <QrCode className="size-16 text-muted-foreground/30 mx-auto mb-3" />
                    <p className="text-sm text-muted-foreground mb-1">
                      สร้าง QR Code สำหรับชำระผ่าน PromptPay
                    </p>
                    <p className="text-xs text-muted-foreground">
                      สแกนจ่ายผ่านแอปธนาคาร สะดวก ปลอดภัย
                    </p>
                  </div>
                )}
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  onClick={handlePromptPayQr}
                  disabled={generateQrMutation.isPending}
                >
                  {generateQrMutation.isPending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      กำลังสร้าง QR...
                    </>
                  ) : qrUrl ? (
                    `ชำระเงิน ${amount.toLocaleString()} บาท`
                  ) : (
                    `สร้าง QR PromptPay ${amount.toLocaleString()} บาท`
                  )}
                </Button>
                <p className="text-xs text-muted-foreground mt-2">
                  ระบบจะตรวจสอบการชำระอัตโนมัติภายใน 5 นาที
                </p>
              </div>
            </TabsContent>

            {/* -- Tab: Pay Solutions Gateway -- */}
            <TabsContent value="gateway">
              <div className="text-center py-2">
                <div className="bg-muted/50 rounded-lg p-6 mb-4">
                  <CreditCard className="size-16 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground mb-1">
                    ชำระผ่าน Pay Solutions
                  </p>
                  <p className="text-xs text-muted-foreground">
                    รองรับบัตรเครดิต/เดบิต, Mobile Banking
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    ระบบจะยืนยันการชำระอัตโนมัติ ไม่ต้องส่งสลิป
                  </p>
                </div>
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  onClick={handleGatewayPay}
                  disabled={createIntentMutation.isPending}
                >
                  {createIntentMutation.isPending ? (
                    <>
                      <Loader2 className="size-4 animate-spin" />
                      กำลังสร้างรายการ...
                    </>
                  ) : (
                    `ชำระเงิน ${amount.toLocaleString()} บาท`
                  )}
                </Button>
              </div>
            </TabsContent>

            {/* -- Tab: Manual Transfer + Slip -- */}
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
                      สแกน QR แล้วโอนเงิน{' '}
                      <span className="text-primary font-bold">
                        {amount.toLocaleString()} บาท
                      </span>
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
                      <span className="font-bold text-primary">
                        {amount.toLocaleString()} บาท
                      </span>
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
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {slipFile.name}
                          </p>
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
                    disabled={!slipFile || slipMutation.isPending}
                  >
                    {slipMutation.isPending ? (
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
