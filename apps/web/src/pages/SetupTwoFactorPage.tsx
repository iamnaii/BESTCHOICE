import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { ShieldCheck, Copy, Check, ArrowRight, AlertTriangle } from 'lucide-react';
import AuthLayout from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import TotpInput from '@/components/TotpInput';
import BackupCodesDisplay from '@/components/BackupCodesDisplay';
import api from '@/lib/api';

type WizardStep = 'qr' | 'verify' | 'backup';

interface EnrollData {
  secret: string;
  otpAuthUrl: string;
  qrCodeDataUrl: string;
}

export default function SetupTwoFactorPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<WizardStep>('qr');
  const [enrollData, setEnrollData] = useState<EnrollData | null>(null);
  const [isLoadingEnroll, setIsLoadingEnroll] = useState(true);
  const [otp, setOtp] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [secretCopied, setSecretCopied] = useState(false);
  const [savedConfirmed, setSavedConfirmed] = useState(false);

  useEffect(() => {
    async function fetchEnroll() {
      try {
        const { data } = await api.post<EnrollData>('/2fa/enroll', {});
        setEnrollData(data);
      } catch {
        toast.error('ไม่สามารถเริ่มตั้งค่า 2FA ได้ กรุณาลองใหม่');
      } finally {
        setIsLoadingEnroll(false);
      }
    }
    fetchEnroll();
  }, []);

  function handleCopySecret() {
    if (!enrollData) return;
    navigator.clipboard.writeText(enrollData.secret).then(() => {
      setSecretCopied(true);
      toast.success('คัดลอก secret key แล้ว');
      setTimeout(() => setSecretCopied(false), 2000);
    });
  }

  async function handleVerify(code: string) {
    if (code.length < 6) return;
    setIsVerifying(true);
    try {
      const { data } = await api.post<{ backupCodes: string[] }>('/2fa/confirm', { token: code });
      setBackupCodes(data.backupCodes);
      setStep('backup');
      toast.success('ยืนยัน 2FA สำเร็จ!');
    } catch {
      toast.error('รหัส OTP ไม่ถูกต้อง กรุณาลองใหม่');
      setOtp('');
    } finally {
      setIsVerifying(false);
    }
  }

  function handleOtpComplete(code: string) {
    handleVerify(code);
  }

  function handleDone() {
    navigate('/');
  }

  const stepLabels: { id: WizardStep; label: string }[] = [
    { id: 'qr', label: 'สแกน QR' },
    { id: 'verify', label: 'ยืนยัน' },
    { id: 'backup', label: 'Backup Codes' },
  ];

  const stepIndex = stepLabels.findIndex((s) => s.id === step);

  return (
    <AuthLayout>
      <div className="mb-7">
        <div className="flex items-center gap-2 mb-2">
          <ShieldCheck className="size-6 text-primary" />
          <h2 className="text-2xl font-bold text-foreground">ตั้งค่ายืนยันตัวตน 2 ขั้น</h2>
        </div>
        <p className="text-sm text-muted-foreground leading-snug">
          เพิ่มความปลอดภัยให้บัญชีด้วย Google Authenticator หรือแอปที่รองรับ TOTP
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {stepLabels.map((s, i) => (
          <div key={s.id} className="flex items-center gap-2">
            <div
              className={`flex items-center justify-center size-7 rounded-full text-xs font-bold transition-colors ${
                i < stepIndex
                  ? 'bg-primary text-primary-foreground'
                  : i === stepIndex
                  ? 'bg-primary text-primary-foreground ring-2 ring-primary/30'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {i < stepIndex ? <Check className="size-3.5" /> : i + 1}
            </div>
            <span
              className={`text-sm ${i === stepIndex ? 'text-foreground font-medium' : 'text-muted-foreground'}`}
            >
              {s.label}
            </span>
            {i < stepLabels.length - 1 && <ArrowRight className="size-3.5 text-muted-foreground mx-1" />}
          </div>
        ))}
      </div>

      <div className="bg-card rounded-xl shadow-card border border-border/60 p-6">
        {/* Step 1: QR Code */}
        {step === 'qr' && (
          <div className="space-y-5">
            <div>
              <h3 className="font-semibold text-foreground mb-1">สแกน QR Code</h3>
              <p className="text-sm text-muted-foreground leading-snug">
                เปิด Google Authenticator แล้วสแกน QR code ด้านล่าง
              </p>
            </div>

            {isLoadingEnroll ? (
              <div className="flex items-center justify-center h-48">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : enrollData ? (
              <>
                <div className="flex justify-center">
                  <div className="p-3 bg-background border border-border rounded-xl">
                    <img
                      src={enrollData.qrCodeDataUrl}
                      alt="QR Code สำหรับ Google Authenticator"
                      className="w-48 h-48"
                    />
                  </div>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground mb-2">
                    สแกนไม่ได้? ใส่ secret key ด้วยตนเอง:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs font-mono bg-muted px-3 py-2 rounded-lg border border-border break-all text-foreground">
                      {enrollData.secret}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCopySecret}
                      className="shrink-0"
                    >
                      {secretCopied ? (
                        <Check className="size-4 text-primary" />
                      ) : (
                        <Copy className="size-4" />
                      )}
                    </Button>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="primary"
                  className="w-full"
                  onClick={() => setStep('verify')}
                >
                  ถัดไป — ยืนยันรหัส
                </Button>
              </>
            ) : (
              <div className="text-center text-destructive text-sm py-8">
                ไม่สามารถโหลด QR code ได้ กรุณารีเฟรชหน้า
              </div>
            )}
          </div>
        )}

        {/* Step 2: Verify OTP */}
        {step === 'verify' && (
          <div className="space-y-5">
            <div>
              <h3 className="font-semibold text-foreground mb-1">ยืนยันรหัส OTP</h3>
              <p className="text-sm text-muted-foreground leading-snug">
                กรอกรหัส 6 หลักจาก Google Authenticator เพื่อยืนยันว่าตั้งค่าถูกต้อง
              </p>
            </div>

            <TotpInput
              value={otp}
              onChange={setOtp}
              onComplete={handleOtpComplete}
              disabled={isVerifying}
              className="py-2"
            />

            <Button
              type="button"
              variant="primary"
              className="w-full"
              disabled={otp.length < 6 || isVerifying}
              onClick={() => handleVerify(otp)}
            >
              {isVerifying ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin size-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  กำลังยืนยัน...
                </span>
              ) : (
                'ยืนยัน'
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full text-muted-foreground"
              onClick={() => { setOtp(''); setStep('qr'); }}
            >
              ย้อนกลับ
            </Button>
          </div>
        )}

        {/* Step 3: Backup Codes */}
        {step === 'backup' && (
          <div className="space-y-5">
            <div>
              <h3 className="font-semibold text-foreground mb-1">Backup Codes</h3>
              <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <AlertTriangle className="size-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700 leading-snug">
                  บันทึก backup codes เหล่านี้ไว้ในที่ปลอดภัย
                  รหัสแต่ละชุดใช้ได้ครั้งเดียว และจะใช้เข้าระบบได้หากไม่มีโทรศัพท์
                </p>
              </div>
            </div>

            <BackupCodesDisplay codes={backupCodes} />

            <div className="flex items-center gap-2 pt-1">
              <Checkbox
                id="saved-confirm"
                checked={savedConfirmed}
                onCheckedChange={(v) => setSavedConfirmed(!!v)}
              />
              <Label htmlFor="saved-confirm" className="text-sm cursor-pointer leading-snug">
                ฉันบันทึก backup codes ไว้ในที่ปลอดภัยแล้ว
              </Label>
            </div>

            <Button
              type="button"
              variant="primary"
              className="w-full"
              disabled={!savedConfirmed}
              onClick={handleDone}
            >
              เสร็จสิ้น
            </Button>
          </div>
        )}
      </div>
    </AuthLayout>
  );
}
