import { useState, useEffect } from 'react';
import { useLiffInit } from '@/hooks/useLiffInit';
import { liffApi } from '@/lib/api';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

type Step = 'loading' | 'phone' | 'confirm' | 'success' | 'already_linked' | 'error';

export default function LiffRegister() {
  const { lineId, profile, loading, error } = useLiffInit();
  const [step, setStep] = useState<Step>('loading');
  const [phone, setPhone] = useState('');
  const [phoneError, setPhoneError] = useState('');
  const [lookupResult, setLookupResult] = useState<{ customerId: string; maskedName: string } | null>(null);

  // Check if already linked
  const { error: checkError } = useQuery({
    queryKey: ['liff-register-check', lineId],
    queryFn: async () => {
      try {
        await liffApi.get(`/line-oa/liff/contracts?lineId=${encodeURIComponent(lineId!)}`);
        setStep('already_linked');
        return { linked: true };
      } catch (err: unknown) {
        const axiosErr = err as { response?: { status?: number } };
        if (axiosErr.response?.status === 404) {
          setStep('phone');
          return { linked: false };
        }
        throw err; // network errors propagate to checkError
      }
    },
    enabled: !!lineId && !loading && !error,
  });

  // Handle LIFF init error → transition step via effect, not during render
  useEffect(() => {
    if (error && step === 'loading') {
      setStep('error');
    }
  }, [error, step]);

  const lookupMutation = useMutation({
    mutationFn: async (cleaned: string) => {
      const { data: result } = await liffApi.post('/line-oa/liff/register/lookup', {
        phone: cleaned,
      });
      return result as { customerId: string; maskedName: string };
    },
    onSuccess: (result) => {
      setLookupResult(result);
      setStep('confirm');
    },
    onError: (err: unknown) => {
      const axiosErr = err as { response?: { status?: number; data?: { message?: string } } };
      if (axiosErr.response?.status === 400) {
        setStep('already_linked');
      } else {
        setPhoneError(axiosErr.response?.data?.message || (err instanceof Error ? err.message : 'เกิดข้อผิดพลาด'));
      }
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!lookupResult || !profile) throw new Error('ข้อมูลไม่ครบ');
      const { data: result } = await liffApi.post('/line-oa/liff/register/confirm', {
        customerId: lookupResult.customerId,
      });
      return result;
    },
    onSuccess: () => {
      setStep('success');
    },
    onError: (err: Error) => {
      toast.error(err.message);
      setStep('error');
    },
  });

  function handlePhoneLookup() {
    setPhoneError('');
    const cleaned = phone.trim();

    if (!/^0\d{8,9}$/.test(cleaned)) {
      setPhoneError('กรุณากรอกเบอร์โทรให้ถูกต้อง (เช่น 0812345678)');
      return;
    }

    lookupMutation.mutate(cleaned);
  }

  const submitting = lookupMutation.isPending || confirmMutation.isPending;
  const errorMessage = error || (checkError as Error)?.message || '';

  // Loading
  if (step === 'loading') {
    return (
      <div className="min-h-screen bg-background p-4 space-y-4">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-20 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  // Error
  if (step === 'error') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <div className="text-destructive text-5xl mb-4">!</div>
            <h2 className="text-lg font-bold mb-2">เกิดข้อผิดพลาด</h2>
            <p className="text-muted-foreground text-sm">{errorMessage}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Already linked
  if (step === 'already_linked') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <div className="text-success text-5xl mb-4">&#10003;</div>
            <h2 className="text-lg font-bold mb-2">ลงทะเบียนแล้ว</h2>
            <p className="text-muted-foreground text-sm mb-6">บัญชี LINE ของคุณเชื่อมต่อกับระบบแล้ว</p>
            <Button variant="primary" size="lg" asChild>
              <a href={`/liff/contract?lineId=${encodeURIComponent(profile?.userId || '')}`}>
                ดูสัญญาของฉัน
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success
  if (step === 'success') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="max-w-md w-full">
          <CardContent className="text-center py-10">
            <div className="text-success text-5xl mb-4">&#10003;</div>
            <h2 className="text-lg font-bold mb-2">ลงทะเบียนสำเร็จ</h2>
            <p className="text-muted-foreground text-sm mb-2">เชื่อมบัญชี LINE กับระบบเรียบร้อยแล้ว</p>
            <p className="text-muted-foreground text-xs mb-6">ตอนนี้คุณสามารถใช้คำสั่งต่างๆ ผ่าน LINE ได้แล้ว</p>
            <Button variant="primary" size="lg" asChild>
              <a href={`/liff/contract?lineId=${encodeURIComponent(profile?.userId || '')}`}>
                ดูสัญญาของฉัน
              </a>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Phone input step
  if (step === 'phone') {
    return (
      <div className="min-h-screen bg-background p-4">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#1e3a5f] to-[#059669] rounded-xl p-5 text-white shadow-md mb-4">
          <p className="text-xs opacity-80">BEST CHOICE</p>
          <h1 className="text-base font-bold mt-1">ลงทะเบียนผูก LINE</h1>
        </div>

        {/* Profile */}
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

        {/* Phone Input */}
        <Card className="mb-4">
          <CardContent>
            <h2 className="text-sm font-bold mb-2">กรอกเบอร์โทรศัพท์</h2>
            <p className="text-xs text-muted-foreground mb-4">กรอกเบอร์โทรที่ลงทะเบียนกับ BEST CHOICE</p>

            <input
              type="tel"
              inputMode="numeric"
              placeholder="0812345678"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value.replace(/\D/g, '').slice(0, 10));
                setPhoneError('');
              }}
              autoComplete="tel"
              className={`w-full px-4 py-3 rounded-lg border text-center text-lg tracking-widest bg-background ${
                phoneError ? 'border-destructive bg-destructive/5' : 'border-input'
              } focus:outline-hidden focus:ring-2 focus:ring-primary/30 focus:border-primary`}
            />
            {phoneError && <p className="text-destructive text-xs mt-2 text-center">{phoneError}</p>}

            <Button
              variant="primary"
              size="lg"
              className="w-full mt-4"
              onClick={handlePhoneLookup}
              disabled={phone.length < 10 || submitting}
            >
              {submitting ? 'กำลังค้นหา...' : 'ค้นหาบัญชี'}
            </Button>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          BEST CHOICE - ระบบผ่อนชำระมือถือ
        </p>
      </div>
    );
  }

  // Confirm step
  if (step === 'confirm' && lookupResult) {
    return (
      <div className="min-h-screen bg-background p-4">
        {/* Header */}
        <div className="bg-primary rounded-xl p-5 text-primary-foreground mb-4">
          <p className="text-xs opacity-80">BEST CHOICE</p>
          <h1 className="text-base font-bold mt-1">ยืนยันตัวตน</h1>
        </div>

        <Card className="mb-4">
          <CardContent className="text-center">
            <p className="text-sm text-muted-foreground mb-2">พบบัญชีในระบบ:</p>
            <p className="text-2xl font-bold mb-1">{lookupResult.maskedName}</p>
            <p className="text-xs text-muted-foreground mb-6">เบอร์โทร: {phone}</p>

            <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-4 mb-6">
              <p className="text-sm text-amber-800 dark:text-amber-200">
                หากชื่อนี้คือคุณ กดยืนยันเพื่อผูกบัญชี LINE กับระบบ
              </p>
            </div>

            <Button
              variant="primary"
              size="lg"
              className="w-full"
              onClick={() => confirmMutation.mutate()}
              disabled={submitting}
            >
              {submitting ? 'กำลังดำเนินการ...' : 'ยืนยัน ใช่ฉันเอง'}
            </Button>

            <Button
              variant="ghost"
              size="lg"
              className="w-full mt-2 text-muted-foreground"
              onClick={() => { setStep('phone'); setPhone(''); setLookupResult(null); }}
            >
              ไม่ใช่ ลองใหม่
            </Button>
          </CardContent>
        </Card>

        <p className="text-center text-xs text-muted-foreground">
          BEST CHOICE - ระบบผ่อนชำระมือถือ
        </p>
      </div>
    );
  }

  return null;
}
