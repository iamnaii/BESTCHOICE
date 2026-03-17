import { useState } from 'react';
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

export default function StepKycVerification({ contractId, customerName, customerPhone, onComplete }: StepKycVerificationProps) {
  const [otp, setOtp] = useState('');
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [idCardDone, setIdCardDone] = useState(false);

  // Check existing KYC status
  const { data: kycStatus } = useQuery<KycStatus>({
    queryKey: ['kyc-status', contractId],
    queryFn: async () => { const { data } = await api.get(`/contracts/${contractId}/kyc/status`); return data; },
    retry: false,
  });

  // If KYC already verified, skip
  const alreadyVerified = kycStatus?.status === 'VERIFIED';

  const sendOtpMutation = useMutation({
    mutationFn: async (channel: string) => {
      const { data } = await api.post(`/contracts/${contractId}/kyc/send-otp`, { channel });
      return data;
    },
    onSuccess: () => {
      setOtpSent(true);
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

  // If already verified from server
  if (alreadyVerified) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] px-4">
        <div className="text-5xl mb-4">&#10003;</div>
        <h2 className="text-xl font-semibold text-green-700 mb-2">ยืนยันตัวตนเรียบร้อยแล้ว</h2>
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
            <div className="flex gap-3">
              <button
                onClick={() => sendOtpMutation.mutate('SMS')}
                disabled={sendOtpMutation.isPending}
                className="flex-1 px-4 py-4 text-sm border-2 border-primary/30 rounded-xl hover:bg-primary/5 flex flex-col items-center gap-2 disabled:opacity-50"
              >
                <span className="text-2xl">💬</span>
                <span className="font-medium">ส่ง OTP ผ่าน SMS</span>
              </button>
              <button
                onClick={() => sendOtpMutation.mutate('LINE')}
                disabled={sendOtpMutation.isPending}
                className="flex-1 px-4 py-4 text-sm border-2 border-green-300 rounded-xl hover:bg-green-50 flex flex-col items-center gap-2 disabled:opacity-50"
              >
                <span className="text-2xl">💚</span>
                <span className="font-medium">ส่ง OTP ผ่าน LINE</span>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground text-center">กรอกรหัส OTP 6 หลักที่ส่งไปยัง {maskedPhone}</p>
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
              <button
                onClick={() => { setOtpSent(false); setOtp(''); }}
                className="text-sm text-primary hover:underline w-full text-center"
              >
                ส่ง OTP อีกครั้ง
              </button>
            </div>
          )}
        </div>
      )}

      {/* Step B: ID Card Photo */}
      {otpVerified && !idCardDone && (
        <div className="w-full space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-green-500 text-sm">&#10003; OTP ยืนยันแล้ว</span>
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
          <h3 className="text-lg font-semibold text-green-700">ยืนยันตัวตนสำเร็จ</h3>
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
