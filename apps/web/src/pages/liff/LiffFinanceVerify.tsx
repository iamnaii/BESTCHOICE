import { useState, useEffect } from 'react';
import { useLiffInit } from '@/hooks/useLiffInit';
import { liffApi } from '@/lib/api';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

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
  useEffect(() => {
    if (loading || error || !lineId) return;

    let cancelled = false;
    (async () => {
      try {
        const { data } = await liffApi.get<LinkStatus>(
          `/chatbot/finance/liff/status?lineUserId=${encodeURIComponent(lineId)}`,
        );
        if (cancelled) return;
        if (data.linked) {
          setVerifiedName(data.customerName || '');
          setStep('already_linked');
        } else {
          setStep('phone');
        }
      } catch (err) {
        if (!cancelled) {
          if (import.meta.env.DEV) console.error('Status check failed:', err);
          setStep('phone'); // ไม่ block — ให้ลูกค้ากรอกเบอร์ได้
        }
      }
    })();
    return () => { cancelled = true; };
  }, [lineId, loading, error]);

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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mx-auto" />
          <p className="mt-4 text-gray-600">กำลังเชื่อมต่อ LINE...</p>
        </div>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-red-500 text-5xl mb-4">!</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">เกิดข้อผิดพลาด</h2>
          <p className="text-gray-600">{error || 'ไม่สามารถเชื่อมต่อ LINE ได้'}</p>
        </div>
      </div>
    );
  }

  if (step === 'already_linked' || step === 'success') {
    const isAlready = step === 'already_linked';
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-green-500 text-5xl mb-4">&#10003;</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">
            {isAlready ? 'ยืนยันแล้ว' : 'ยืนยันสำเร็จ'}
          </h2>
          {verifiedName && (
            <p className="text-gray-600 mb-2">คุณ{verifiedName}</p>
          )}
          <p className="text-gray-500 text-sm mb-6">
            {isAlready
              ? 'บัญชี LINE ของคุณได้รับการยืนยันแล้ว'
              : 'ตอนนี้คุณสามารถสอบถามข้อมูลผ่านน้องเบสได้แล้ว'}
          </p>
          <button
            onClick={() => window.liff?.closeWindow?.()}
            className="inline-block bg-blue-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-blue-700 transition-colors"
          >
            กลับไปแชท
          </button>
        </div>
      </div>
    );
  }

  if (step === 'phone') {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="bg-blue-600 rounded-2xl p-6 text-white mb-6">
          <p className="text-xs opacity-80">BEST CHOICE FINANCE</p>
          <h1 className="text-lg font-bold mt-1">ยืนยันตัวตน</h1>
        </div>

        {profile && (
          <div className="bg-white rounded-2xl shadow-sm p-5 mb-4 flex items-center gap-4">
            {profile.pictureUrl ? (
              <img src={profile.pictureUrl} alt="" className="w-12 h-12 rounded-full" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-lg">
                {profile.displayName.charAt(0)}
              </div>
            )}
            <div>
              <p className="font-medium text-gray-800">{profile.displayName}</p>
              <p className="text-xs text-gray-400">บัญชี LINE ของคุณ</p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm p-5 mb-4">
          <h2 className="text-sm font-bold text-gray-800 mb-2">กรอกเบอร์โทรศัพท์</h2>
          <p className="text-xs text-gray-400 mb-4">เบอร์ที่ลงทะเบียนกับ BEST CHOICE</p>

          <input
            type="tel"
            inputMode="numeric"
            placeholder="0812345678"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value.replace(/\D/g, '').slice(0, 10));
              setPhoneError('');
            }}
            className={`w-full px-4 py-3 rounded-xl border text-center text-lg tracking-widest ${
              phoneError ? 'border-red-400 bg-red-50' : 'border-gray-300'
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
          />
          {phoneError && <p className="text-red-500 text-xs mt-2 text-center">{phoneError}</p>}

          <button
            onClick={handleSubmitPhone}
            disabled={phone.length < 10 || requestOtpMutation.isPending}
            className={`w-full mt-4 py-3 rounded-xl font-medium text-white transition-colors ${
              phone.length >= 10 && !requestOtpMutation.isPending
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-gray-300 cursor-not-allowed'
            }`}
          >
            {requestOtpMutation.isPending ? 'กำลังส่ง OTP...' : 'ส่งรหัส OTP'}
          </button>

          <p className="text-center text-xs text-gray-400 mt-3">
            จะมี SMS ส่งรหัส 6 หลักให้ภายใน 1 นาที
          </p>
        </div>
      </div>
    );
  }

  if (step === 'otp') {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <div className="bg-blue-600 rounded-2xl p-6 text-white mb-6">
          <p className="text-xs opacity-80">BEST CHOICE FINANCE</p>
          <h1 className="text-lg font-bold mt-1">ยืนยันรหัส OTP</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-5 mb-4">
          <p className="text-sm text-gray-600 mb-2">ส่งรหัส OTP ไปที่:</p>
          <p className="text-lg font-bold text-gray-800 mb-4">{maskedPhone}</p>

          <input
            type="tel"
            inputMode="numeric"
            placeholder="000000"
            value={otp}
            onChange={(e) => {
              setOtp(e.target.value.replace(/\D/g, '').slice(0, 6));
              setOtpError('');
            }}
            className={`w-full px-4 py-3 rounded-xl border text-center text-2xl tracking-[0.5em] ${
              otpError ? 'border-red-400 bg-red-50' : 'border-gray-300'
            } focus:outline-none focus:ring-2 focus:ring-blue-500`}
            maxLength={6}
          />
          {otpError && <p className="text-red-500 text-xs mt-2 text-center">{otpError}</p>}

          <button
            onClick={handleSubmitOtp}
            disabled={otp.length !== 6 || verifyOtpMutation.isPending}
            className={`w-full mt-4 py-3 rounded-xl font-medium text-white transition-colors ${
              otp.length === 6 && !verifyOtpMutation.isPending
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-gray-300 cursor-not-allowed'
            }`}
          >
            {verifyOtpMutation.isPending ? 'กำลังตรวจสอบ...' : 'ยืนยัน'}
          </button>

          <button
            onClick={handleResendOtp}
            disabled={resendCooldown > 0 || requestOtpMutation.isPending}
            className={`w-full mt-2 py-3 rounded-xl font-medium transition-colors ${
              resendCooldown > 0
                ? 'text-gray-400 cursor-not-allowed'
                : 'text-blue-600 hover:bg-blue-50'
            }`}
          >
            {resendCooldown > 0 ? `ขอรหัสใหม่อีกครั้งใน ${resendCooldown} วินาที` : 'ขอรหัสใหม่'}
          </button>

          <button
            onClick={() => { setStep('phone'); setOtp(''); setOtpError(''); }}
            className="w-full mt-1 py-2 text-sm text-gray-500 hover:text-gray-700"
          >
            ← เปลี่ยนเบอร์
          </button>
        </div>
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
