import { useId, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { saveConsent } from '@/lib/consent';
import { useConsent } from '@/hooks/useConsent';
import { CONSENT_SAVED_MESSAGE } from './CookieBanner';
import { isPrerendering } from './prerender';
import { useConsentUi } from './useConsentUi';
import { MARKETING_ROW_TEXT } from './vendors';

function ConsentSwitch({
  checked,
  labelledBy,
  onChange,
}: {
  checked: boolean;
  labelledBy: string;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={labelledBy}
      onClick={() => onChange(!checked)}
      className="grid h-11 w-14 shrink-0 cursor-pointer place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <span
        aria-hidden
        className={cn(
          'flex h-7 w-12 items-center rounded-full px-0.5 transition-colors',
          checked ? 'bg-brand-green-dark' : 'bg-muted-foreground/40',
        )}
      >
        <span
          className={cn(
            'size-6 rounded-full bg-background shadow transition-transform',
            checked ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </span>
    </button>
  );
}

/** เมาท์เฉพาะตอนเปิด — draft เริ่มจากความยินยอมปัจจุบันทุกครั้งที่เปิด */
function SettingsForm({ onDone }: { onDone: () => void }) {
  const current = useConsent();
  const [analytics, setAnalytics] = useState(current.analytics);
  const [marketing, setMarketing] = useState(current.marketing);
  const uid = useId();
  const anId = `${uid}-an`;
  const mkId = `${uid}-mk`;

  const save = (a: boolean, m: boolean) => {
    saveConsent({ analytics: a, marketing: m });
    onDone();
    toast.success(CONSENT_SAVED_MESSAGE);
  };

  return (
    <>
      <DialogHeader className="text-start">
        <DialogTitle>ตั้งค่าคุกกี้</DialogTitle>
        <DialogDescription className="leading-snug">
          เลือกได้ว่าจะให้เราใช้คุกกี้ประเภทใด ผลการเลือกเก็บไว้ในเบราว์เซอร์นี้{' '}
          <Link to="/privacy" className="font-semibold text-foreground underline">
            นโยบายความเป็นส่วนตัว
          </Link>
        </DialogDescription>
      </DialogHeader>

      <div className="divide-y divide-border">
        <div className="py-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-semibold leading-snug">คุกกี้ที่จำเป็น</p>
            <span className="text-sm font-semibold leading-snug text-muted-foreground">
              เปิดเสมอ
            </span>
          </div>
          <p className="mt-1 text-sm leading-snug text-muted-foreground">
            ทำให้เว็บไซต์ใช้งานได้ เช่น การเข้าสู่ระบบ การจำผลการเลือกคุกกี้ของคุณ
            และการนับจำนวนผู้เข้าชมของร้าน
          </p>
        </div>
        <div className="py-3">
          <div className="flex items-center justify-between gap-3">
            <p id={anId} className="text-sm font-semibold leading-snug">
              คุกกี้เพื่อการวิเคราะห์
            </p>
            <ConsentSwitch checked={analytics} labelledBy={anId} onChange={setAnalytics} />
          </div>
          <p className="mt-1 text-sm leading-snug text-muted-foreground">
            ช่วยให้เรารู้ว่าหน้าไหนมีคนดูมาก เพื่อปรับปรุงเว็บไซต์ (Google Analytics)
          </p>
        </div>
        <div className="py-3">
          <div className="flex items-center justify-between gap-3">
            <p id={mkId} className="text-sm font-semibold leading-snug">
              คุกกี้เพื่อการตลาด
            </p>
            <ConsentSwitch checked={marketing} labelledBy={mkId} onChange={setMarketing} />
          </div>
          <p className="mt-1 text-sm leading-snug text-muted-foreground">{MARKETING_ROW_TEXT}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 items-stretch gap-2">
        <Button
          variant="primary"
          className="whitespace-normal h-auto min-h-11 px-2 py-2 leading-snug"
          onClick={() => save(true, true)}
        >
          ยอมรับทั้งหมด
        </Button>
        <Button
          variant="primary"
          className="whitespace-normal h-auto min-h-11 px-2 py-2 leading-snug"
          onClick={() => save(false, false)}
        >
          ปฏิเสธทั้งหมด
        </Button>
        <Button
          variant="outline"
          className="whitespace-normal h-auto min-h-11 px-2 py-2 leading-snug"
          onClick={() => save(analytics, marketing)}
        >
          บันทึกที่เลือก
        </Button>
      </div>
    </>
  );
}

export default function CookieSettingsDialog() {
  const open = useConsentUi((s) => s.settingsOpen);
  const closeSettings = useConsentUi((s) => s.closeSettings);

  if (isPrerendering()) return null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeSettings()}>
      <DialogContent data-consent-ui className="max-h-[90dvh] overflow-y-auto">
        <SettingsForm onDone={closeSettings} />
      </DialogContent>
    </Dialog>
  );
}
