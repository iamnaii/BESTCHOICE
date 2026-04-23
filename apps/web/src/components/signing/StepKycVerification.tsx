import { useState, useEffect, useRef, useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import OtpInput from './OtpInput';
import IdCardCapture from './IdCardCapture';

interface StepKycVerificationProps {
  contractId: string;
  customerName: string;
  customerPhone: string;
  onComplete: () => void;
}

interface KycStatus {
  otpVerified: boolean;
  idCardUploaded: boolean;
  status: string;
}

interface SendOtpResponse {
  id: string;
  channel: string;
  phone: string;
  refCode?: string;
  expiresAt: string;
  expiryMinutes?: number;
  message: string;
}

const OTP_EXPIRY_SECONDS = 10 * 60; // 10 minutes

export default function StepKycVerification({ contractId, customerName, customerPhone, onComplete }: StepKycVerificationProps) {
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [idCardDone, setIdCardDone] = useState(false);
  const [otpRef, setOtpRef] = useState('');
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check existing KYC status
  const { data: kycStatus } = useQuery<KycStatus>({
    queryKey: ['kyc-status', contractId],
    queryFn: async () => { const { data } = await api.get(`/contracts/${contractId}/kyc/status`); return data; },
    retry: false,
  });

  // If KYC already verified, skip
  const alreadyVerified = kycStatus?.status === 'VERIFIED';

  // Countdown timer
  useEffect(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (!otpSent || otpVerified || countdown <= 0) return;

    countdownRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => { if (countdownRef.current) clearInterval(countdownRef.current); };
  }, [otpSent, otpVerified]); // countdown intentionally omitted — interval manages its own decrement

  const handleSendOtp = useCallback(() => {
    sendOtpMutation.mutate();
  }, []); // sendOtpMutation intentionally omitted — declared below, stable reference

  const sendOtpMutation = useMutation({
    mutationFn: async () => {
      const { data } = await api.post(`/contracts/${contractId}/kyc/send-otp`, {});
      return data as SendOtpResponse;
    },
    onSuccess: (data) => {
      setOtpSent(true);
      setOtp('');
      setOtpRef(data.refCode || '');
      setCountdown(OTP_EXPIRY_SECONDS);
      toast.success('ส่ง OTP แล้ว');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const verifyOtpMutation = useMutation({
    mutationFn: async (otpCode: string) => {
      const { data } = await api.post(`/contracts/${contractId}/kyc/verify-otp`, { otp: otpCode });
      return data;
    },
    onSuccess: () => {
      setOtpVerified(true);
      setCountdown(0);
      toast.success('ยืนยัน OTP สำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const uploadIdCardMutation = useMutation({
    mutationFn: async (imageBase64: string) => {
      const { data } = await api.post(`/contracts/${contractId}/kyc/upload-id-card`, {
        imageBase64,
        deviceInfo: navigator.userAgent,
      });
      return data;
    },
    onSuccess: () => {
      setIdCardDone(true);
      toast.success('อัปโหลดรูปบัตรประชาชนสำเร็จ');
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const maskedPhone = customerPhone
    ? customerPhone.slice(0, 3) + '-xxx-x' + customerPhone.slice(-3)
    : 'ไม่มีเบอร์';

  const formatCountdown = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // If already verified from server
  if (alreadyVerified) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] px-4">
        <div className="text-5xl mb-4">&#10003;</div>
        <h2 className="text-xl font-semibold text-success mb-2">ยืนยันตัวตนเรียบร้อยแล้ว</h2>
        <p className="text-sm text-muted-foreground mb-6">{customerName}</p>
        <button
          onClick={onComplete}
          className="px-8 py-3.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90"
        >
          ดำเนินการต่อ
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center px-4 max-w-lg mx-auto py-6">
      <h2 className="text-xl font-semibold text-foreground mb-6">ยืนยันตัวตนลูกค้า</h2>

      {/* Customer info */}
      <div className="w-full bg-muted rounded-xl p-4 mb-6 text-center">
        <div className="text-lg font-medium">{customerName}</div>
        <div className="text-sm text-muted-foreground mt-1">{maskedPhone}</div>
      </div>

      {/* Step A: OTP */}
      {!otpVerified && (
        <div className="w-full space-y-4">
          <h3 className="text-sm font-semibold text-foreground">ขั้นตอนที่ 1: ยืนยัน OTP</h3>

          {!otpSent ? (
            <button
              onClick={handleSendOtp}
              disabled={sendOtpMutation.isPending}
              className="w-full px-4 py-4 text-sm bg-primary text-primary-foreground rounded-xl hover:bg-primary/90 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              <span className="font-medium">
                {sendOtpMutation.isPending
                  ? 'กำลังส่ง OTP...'
                  : `ส่ง OTP ผ่าน SMS ไปที่ ${maskedPhone}`}
              </span>
            </button>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">กรอกรหัส OTP 6 หลักที่ส่งไปยัง {maskedPhone}</p>

              {/* Ref Code */}
              {otpRef && (
                <div className="bg-info/10 border border-info/30 rounded-lg px-4 py-2.5 text-center">
                  <span className="text-xs text-info">Ref:</span>
                  <span className="ml-2 text-lg font-bold text-info tracking-widest">{otpRef}</span>
                  <p className="text-xs text-info mt-0.5">ตรวจสอบ Ref ให้ตรงกับ SMS ที่ได้รับ</p>
                </div>
              )}

              {/* OTP Input */}
              <OtpInput
                value={otp}
                onChange={(val) => {
                  setOtp(val);
                  if (val.length === 6) verifyOtpMutation.mutate(val);
                }}
                disabled={verifyOtpMutation.isPending}
              />

              {verifyOtpMutation.isPending && (
                <div className="text-center text-sm text-muted-foreground">กำลังตรวจสอบ...</div>
              )}

              {/* Countdown + Resend */}
              <div className="text-center space-y-2">
                {countdown > 0 ? (
                  <p className="text-sm text-muted-foreground">
                    OTP หมดอายุใน <span className="font-mono font-semibold text-foreground">{formatCountdown(countdown)}</span>
                  </p>
                ) : otpSent ? (
                  <p className="text-sm text-warning font-medium">OTP หมดอายุแล้ว กรุณากดส่งใหม่</p>
                ) : null}

                <button
                  onClick={() => { setOtp(''); handleSendOtp(); }}
                  disabled={sendOtpMutation.isPending}
                  className="text-sm text-primary hover:underline disabled:opacity-50"
                >
                  {sendOtpMutation.isPending ? 'กำลังส่ง...' : 'ส่ง OTP อีกครั้ง'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Step B: ID Card Photo */}
      {otpVerified && !idCardDone && (
        <div className="w-full space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-success text-sm">&#10003; OTP ยืนยันแล้ว</span>
          </div>
          <h3 className="text-sm font-semibold text-foreground">ขั้นตอนที่ 2: ถ่ายรูปบัตรประชาชน</h3>
          <p className="text-xs text-muted-foreground">ถ่ายรูปด้านหน้าบัตรประชาชนของลูกค้าเพื่อยืนยันตัวตน</p>
          <IdCardCapture
            onCapture={(img) => uploadIdCardMutation.mutate(img)}
            disabled={uploadIdCardMutation.isPending}
          />
          {uploadIdCardMutation.isPending && (
            <div className="text-center text-sm text-muted-foreground">กำลังอัปโหลด...</div>
          )}
        </div>
      )}

      {/* Done */}
      {otpVerified && idCardDone && (
        <div className="w-full text-center space-y-4">
          <div className="text-4xl mb-2">&#10003;</div>
          <h3 className="text-lg font-semibold text-success">ยืนยันตัวตนสำเร็จ</h3>
          <button
            onClick={onComplete}
            className="w-full px-8 py-3.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90"
          >
            ดำเนินการต่อ
          </button>
        </div>
      )}
    </div>
  );
}
