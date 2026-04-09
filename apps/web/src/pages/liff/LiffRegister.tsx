import { useState, useEffect } from 'react';
import { useLiffInit } from '@/hooks/useLiffInit';
import { liffApi } from '@/lib/api';
import { useQuery, useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

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
        lineId: profile!.userId,
      });
      if (result.alreadyLinked) {
        return { alreadyLinked: true as const };
      }
      if (result.error) {
        throw new Error(result.error);
      }
      return result as { customerId: string; maskedName: string };
    },
    onSuccess: (result) => {
      if ('alreadyLinked' in result && result.alreadyLinked) {
        setStep('already_linked');
      } else {
        setLookupResult(result as { customerId: string; maskedName: string });
        setStep('confirm');
      }
    },
    onError: (err: Error) => {
      setPhoneError(err.message);
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!lookupResult || !profile) throw new Error('ข้อมูลไม่ครบ');
      const { data: result } = await liffApi.post('/line-oa/liff/register/confirm', {
        customerId: lookupResult.customerId,
        lineId: profile.userId,
        displayName: profile.displayName,
      });
      if (result.error) throw new Error(result.error);
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-500 mx-auto" />
          <p className="mt-4 text-gray-600">กำลังเชื่อมต่อ LINE...</p>
        </div>
      </div>
    );
  }

  // Error
  if (step === 'error') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-red-500 text-5xl mb-4">!</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">เกิดข้อผิดพลาด</h2>
          <p className="text-gray-600">{errorMessage}</p>
        </div>
      </div>
    );
  }

  // Already linked
  if (step === 'already_linked') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-green-500 text-5xl mb-4">&#10003;</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">ลงทะเบียนแล้ว</h2>
          <p className="text-gray-600 mb-6">บัญชี LINE ของคุณเชื่อมต่อกับระบบแล้ว</p>
          <a
            href={`/liff/contract?lineId=${encodeURIComponent(profile?.userId || '')}`}
            className="inline-block bg-green-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-green-700 transition-colors"
          >
            ดูสัญญาของฉัน
          </a>
        </div>
      </div>
    );
  }

  // Success
  if (step === 'success') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md w-full text-center">
          <div className="text-green-500 text-5xl mb-4">&#10003;</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">ลงทะเบียนสำเร็จ</h2>
          <p className="text-gray-600 mb-2">เชื่อมบัญชี LINE กับระบบเรียบร้อยแล้ว</p>
          <p className="text-gray-500 text-sm mb-6">ตอนนี้คุณสามารถใช้คำสั่งต่างๆ ผ่าน LINE ได้แล้ว</p>
          <a
            href={`/liff/contract?lineId=${encodeURIComponent(profile?.userId || '')}`}
            className="inline-block bg-green-600 text-white px-6 py-3 rounded-xl font-medium hover:bg-green-700 transition-colors"
          >
            ดูสัญญาของฉัน
          </a>
        </div>
      </div>
    );
  }

  // Phone input step
  if (step === 'phone') {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        {/* Header */}
        <div className="bg-green-600 rounded-2xl p-6 text-white mb-6">
          <p className="text-xs opacity-80">BEST CHOICE</p>
          <h1 className="text-lg font-bold mt-1">ลงทะเบียนผูก LINE</h1>
        </div>

        {/* Profile */}
        {profile && (
          <div className="bg-white rounded-2xl shadow-sm p-5 mb-4 flex items-center gap-4">
            {profile.pictureUrl ? (
              <img src={profile.pictureUrl} alt="รูปโปรไฟล์ LINE" className="w-12 h-12 rounded-full" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center text-green-600 font-bold text-lg">
                {profile.displayName.charAt(0)}
              </div>
            )}
            <div>
              <p className="font-medium text-gray-800">{profile.displayName}</p>
              <p className="text-xs text-gray-400">บัญชี LINE ของคุณ</p>
            </div>
          </div>
        )}

        {/* Phone Input */}
        <div className="bg-white rounded-2xl shadow-sm p-5 mb-4">
          <h2 className="text-sm font-bold text-gray-800 mb-2">กรอกเบอร์โทรศัพท์</h2>
          <p className="text-xs text-gray-400 mb-4">กรอกเบอร์โทรที่ลงทะเบียนกับ BEST CHOICE</p>

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
            className={`w-full px-4 py-3 rounded-xl border text-center text-lg tracking-widest ${
              phoneError ? 'border-red-400 bg-red-50' : 'border-gray-300'
            } focus:outline-none focus:ring-2 focus:ring-green-500`}
          />
          {phoneError && <p className="text-red-500 text-xs mt-2 text-center">{phoneError}</p>}

          <button
            onClick={handlePhoneLookup}
            disabled={phone.length < 10 || submitting}
            className={`w-full mt-4 py-3 rounded-xl font-medium text-white transition-colors ${
              phone.length >= 10 && !submitting
                ? 'bg-green-600 hover:bg-green-700'
                : 'bg-gray-300 cursor-not-allowed'
            }`}
          >
            {submitting ? 'กำลังค้นหา...' : 'ค้นหาบัญชี'}
          </button>
        </div>

        <p className="text-center text-xs text-gray-400">
          BEST CHOICE - ระบบผ่อนชำระมือถือ
        </p>
      </div>
    );
  }

  // Confirm step
  if (step === 'confirm' && lookupResult) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        {/* Header */}
        <div className="bg-green-600 rounded-2xl p-6 text-white mb-6">
          <p className="text-xs opacity-80">BEST CHOICE</p>
          <h1 className="text-lg font-bold mt-1">ยืนยันตัวตน</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-sm p-5 mb-4 text-center">
          <p className="text-sm text-gray-500 mb-2">พบบัญชีในระบบ:</p>
          <p className="text-2xl font-bold text-gray-800 mb-1">{lookupResult.maskedName}</p>
          <p className="text-xs text-gray-400 mb-6">เบอร์โทร: {phone}</p>

          <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 mb-6">
            <p className="text-sm text-yellow-800">
              หากชื่อนี้คือคุณ กดยืนยันเพื่อผูกบัญชี LINE กับระบบ
            </p>
          </div>

          <button
            onClick={() => confirmMutation.mutate()}
            disabled={submitting}
            className={`w-full py-3 rounded-xl font-medium text-white transition-colors ${
              !submitting ? 'bg-green-600 hover:bg-green-700' : 'bg-gray-300 cursor-not-allowed'
            }`}
          >
            {submitting ? 'กำลังดำเนินการ...' : 'ยืนยัน ใช่ฉันเอง'}
          </button>

          <button
            onClick={() => { setStep('phone'); setPhone(''); setLookupResult(null); }}
            className="w-full mt-2 py-3 rounded-xl font-medium text-gray-600 hover:bg-gray-100 transition-colors"
          >
            ไม่ใช่ ลองใหม่
          </button>
        </div>

        <p className="text-center text-xs text-gray-400">
          BEST CHOICE - ระบบผ่อนชำระมือถือ
        </p>
      </div>
    );
  }

  return null;
}
