import { useState, useEffect } from 'react';
import { useLiffInit } from '@/hooks/useLiffInit';
import { liffApi } from '@/lib/api';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

type Step = 'loading' | 'phone' | 'otp' | 'success' | 'already_linked' | 'error';

interface LinkStatus {
  linked: boolean;
  customerName?: string;
}

interface RequestOtpResponse {
  maskedPhone: string;
  expiresInSeconds: number;
}

interface VerifyOtpResponse {
  customerId: string;
  customerName: string;
}

const COOLDOWN_SECONDS = 60;

export default function LiffFinanceVerify() {
  const { lineId, profile, loading, error } = useLiffInit();
  const [step, setStep] = useState<Step>('loading');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [otp, setOtp] = useState('');
  const [otpError, setOtpError] = useState('');
  const [maskedPhone, setMaskedPhone] = useState('');
  const [verifiedName, setVerifiedName] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);

  // Check link status เมื่อ LIFF init เสร็จ
  const statusQuery = useQuery<LinkStatus>({
    queryKey: ['liff-finance-verify-status', lineId],
    queryFn: async () => {
      const { data } = await liffApi.get<LinkStatus>(
        `/chatbot/finance/liff/status?lineUserId=${encodeURIComponent(lineId)}`,
      );
      return data;
    },
    enabled: !!lineId && !loading && !error,
    retry: 1,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!statusQuery.data && !statusQuery.error) return;
    if (statusQuery.error) {
      setStep('phone');
      return;
    }
    if (statusQuery.data?.linked) {
      setVerifiedName(statusQuery.data.customerName || '');
      setStep('already_linked');
    } else {
      setStep('phone');
    }
  }, [statusQuery.data, statusQuery.error]);

  // Cooldown countdown
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown(resendCooldown - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  // LIFF init error → error step
  useEffect(() => {
    if (error && step === 'loading') setStep('error');
  }, [error, step]);

  const requestOtpMutation = useMutation({
    mutationFn: async (phoneInput: string) => {
      const { data } = await liffApi.post<RequestOtpResponse>(
        '/chatbot/finance/liff/request-otp',
        { lineUserId: lineId, phone: phoneInput },
      );
      return data;
    },
    onSuccess: (data) => {
      setMaskedPhone(data.maskedPhone);
      setStep('otp');
      setResendCooldown(COOLDOWN_SECONDS);
      setOtpError('');
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } }).response?.data?.message ||
        (err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
      setPhoneError(msg);
    },
  });

  const verifyOtpMutation = useMutation({
    mutationFn: async (otpInput: string) => {
      const { data } = await liffApi.post<VerifyOtpResponse>(
        '/chatbot/finance/liff/verify-otp',
        { lineUserId: lineId, otp: otpInput },
      );
      return data;
    },
    onSuccess: (data) => {
      setVerifiedName(data.customerName);
      setStep('success');
      toast.success('ยืนยันตัวตนสำเร็จ');
    },
    onError: (err: unknown) => {
      const msg =
        (err as { response?: { data?: { message?: string } } }).response?.data?.message ||
        (err instanceof Error ? err.message : 'OTP ไม่ถูกต้อง');
      setOtpError(msg);
    },
  });

  function handleSubmitPhone() {
    setPhoneError('');
    const cleaned = phone.replace(/\D/g, '');
    if (!/^0\d{8,9}$/.test(cleaned)) {
      setPhoneError('กรุณากรอกเบอร์โทรให้ถูกต้อง (เช่น 0812345678)');
      return;
    }
    requestOtpMutation.mutate(cleaned);
  }

  function handleSubmitOtp() {
    setOtpError('');
    const cleaned = otp.replace(/\D/g, '');
    if (cleaned.length !== 6) {
      setOtpError('กรุณากรอก OTP 6 หลัก');
      return;
    }
    verifyOtpMutation.mutate(cleaned);
  }

  function handleResendOtp() {
    if (resendCooldown > 0) return;
    requestOtpMutation.mutate(phone.replace(/\D/g, ''));
  }

  // ─── Render states ─────────────────────────────────────

  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <div className="text-destructive text-5xl mb-4">!</div>
            <h2 className="text-lg font-bold mb-2">เกิดข้อผิดพลาด</h2>
            <p className="text-muted-foreground text-sm">{error || 'ไม่สามารถเชื่อมต่อ LINE ได้'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'already_linked' || step === 'success') {
    const isAlready = step === 'already_linked';
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <div className="text-success text-5xl mb-4">&#10003;</div>
            <h2 className="text-lg font-bold mb-2">
              {isAlready ? 'ยืนยันแล้ว' : 'ยืนยันสำเร็จ'}
            </h2>
            {verifiedName && (
              <p className="text-muted-foreground mb-2">คุณ{verifiedName}</p>
            )}
            <p className="text-muted-foreground text-sm mb-6">
              {isAlready
                ? 'บัญชี LINE ของคุณได้รับการยืนยันแล้ว'
                : 'ตอนนี้คุณสามารถสอบถามข้อมูลผ่านน้องเบสได้แล้ว'}
            </p>
            <Button
              variant="primary"
              size="lg"
              onClick={() => window.liff?.closeWindow?.()}
            >
              กลับไปแชท
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'phone') {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="bg-primary rounded-xl p-5 text-primary-foreground mb-4">
          <p className="text-xs opacity-80">BEST CHOICE FINANCE</p>
          <h1 className="text-base font-bold mt-1">ยืนยันตัวตน</h1>
        </div>

        {profile && (
          <Card className="mb-4">
            <CardContent className="py-4">
              <div className="flex items-center gap-4">
                {profile.pictureUrl ? (
                  <img src={profile.pictureUrl} alt="รูปโปรไฟล์ LINE" className="w-12 h-12 rounded-full" />
                ) : (
                  <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-lg">
                    {profile.displayName.charAt(0)}
                  </div>
                )}
                <div>
                  <p className="font-medium">{profile.displayName}</p>
                  <p className="text-xs text-muted-foreground">บัญชี LINE ของคุณ</p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="mb-4">
          <CardContent>
            <h2 className="text-sm font-bold mb-2">กรอกเบอร์โทรศัพท์</h2>
            <p className="text-xs text-muted-foreground mb-4">เบอร์ที่ลงทะเบียนกับ BEST CHOICE</p>

            <input
              type="tel"
              inputMode="numeric"
              placeholder="0812345678"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value.replace(/\D/g, '').slice(0, 10));
                setPhoneError('');
              }}
              className={`w-full px-4 py-3 rounded-lg border text-center text-lg tracking-widest bg-background ${
                phoneError ? 'border-destructive bg-destructive/5' : 'border-input'
              } focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary`}
            />
            {phoneError && <p className="text-destructive text-xs mt-2 text-center">{phoneError}</p>}

            <Button
              variant="primary"
              size="lg"
              className="w-full mt-4"
              onClick={handleSubmitPhone}
              disabled={phone.length < 10 || requestOtpMutation.isPending}
            >
              {requestOtpMutation.isPending ? 'กำลังส่ง OTP...' : 'ส่งรหัส OTP'}
            </Button>

            <p className="text-center text-xs text-muted-foreground mt-3">
              จะมี SMS ส่งรหัส 6 หลักให้ภายใน 1 นาที
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (step === 'otp') {
    return (
      <div className="min-h-screen bg-background p-4">
        <div className="bg-primary rounded-xl p-5 text-primary-foreground mb-4">
          <p className="text-xs opacity-80">BEST CHOICE FINANCE</p>
          <h1 className="text-base font-bold mt-1">ยืนยันรหัส OTP</h1>
        </div>

        <Card className="mb-4">
          <CardContent>
            <p className="text-sm text-muted-foreground mb-2">ส่งรหัส OTP ไปที่:</p>
            <p className="text-lg font-bold mb-4">{maskedPhone}</p>

            <input
              type="tel"
              inputMode="numeric"
              placeholder="000000"
              value={otp}
              onChange={(e) => {
                setOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
                setOtpError('');
              }}
              className={`w-full px-4 py-3 rounded-lg border text-center text-2xl tracking-[0.5em] bg-background ${
                otpError ? 'border-destructive bg-destructive/5' : 'border-input'
              } focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary`}
              maxLength={6}
            />
            {otpError && <p className="text-destructive text-xs mt-2 text-center">{otpError}</p>}

            <Button
              variant="primary"
              size="lg"
              className="w-full mt-4"
              onClick={handleSubmitOtp}
              disabled={otp.length !== 6 || verifyOtpMutation.isPending}
            >
              {verifyOtpMutation.isPending ? 'กำลังตรวจสอบ...' : 'ยืนยัน'}
            </Button>

            <Button
              variant="ghost"
              size="lg"
              className="w-full mt-2"
              onClick={handleResendOtp}
              disabled={resendCooldown > 0 || requestOtpMutation.isPending}
            >
              {resendCooldown > 0 ? `ขอรหัสใหม่อีกครั้งใน ${resendCooldown} วินาที` : 'ขอรหัสใหม่'}
            </Button>

            <Button
              variant="ghost"
              mode="link"
              className="w-full mt-1 text-muted-foreground"
              onClick={() => { setStep('phone'); setOtp(''); setOtpError(''); }}
            >
              ← เปลี่ยนเบอร์
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return null;
}

// Type augmentation for LIFF SDK on window (closeWindow)
declare global {
  interface Window {
    liff?: { closeWindow?: () => void };
  }
}
