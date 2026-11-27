import { useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { saveConsent } from '@/lib/consent';
import { useConsent } from '@/hooks/useConsent';
import { isPrerendering } from './prerender';
import { useConsentUi } from './useConsentUi';

export const CONSENT_SAVED_MESSAGE = 'บันทึกการตั้งค่าคุกกี้แล้ว';

export const BANNER_OFFSET_VAR = '--cookie-banner-offset';

export default function CookieBanner() {
  const { decided } = useConsent();
  const openSettings = useConsentUi((s) => s.openSettings);
  const ref = useRef<HTMLDivElement>(null);
  const visible = !decided && !isPrerendering();

  // วัดระยะจากขอบล่างจอถึงขอบบนแบนเนอร์ ให้ปุ่มแชท/แถบล่างลอยเหนือแบนเนอร์ได้
  useLayoutEffect(() => {
    const el = ref.current;
    if (!visible || !el) return;
    const root = document.documentElement;
    const update = () => {
      const offset = Math.max(0, Math.round(window.innerHeight - el.getBoundingClientRect().top));
      root.style.setProperty(BANNER_OFFSET_VAR, `${offset}px`);
    };
    update();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    ro?.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', update);
      root.style.removeProperty(BANNER_OFFSET_VAR);
    };
  }, [visible]);

  if (!visible) return null;

  const choose = (analytics: boolean, marketing: boolean) => {
    saveConsent({ analytics, marketing });
    toast.success(CONSENT_SAVED_MESSAGE);
  };

  return (
    <div
      ref={ref}
      role="region"
      aria-label="การใช้คุกกี้"
      data-consent-ui
      className="fixed inset-x-0 bottom-0 z-[45] border-t border-border bg-background px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-lg md:inset-x-auto md:bottom-4 md:left-1/2 md:w-[min(56rem,calc(100%-2rem))] md:-translate-x-1/2 md:rounded-2xl md:border md:p-5"
    >
      <div className="md:flex md:items-center md:gap-6">
        <div className="md:flex-1">
          <h2 className="text-base font-semibold leading-snug text-foreground">
            เว็บไซต์นี้ใช้คุกกี้
          </h2>
          <p className="mt-1 text-sm leading-snug text-muted-foreground">
            คุกกี้ที่จำเป็นทำให้เว็บไซต์ใช้งานได้
            ส่วนคุกกี้เพื่อการวิเคราะห์และการตลาดจะทำงานเมื่อคุณอนุญาตเท่านั้น
            เปลี่ยนใจได้ทุกเมื่อที่ "ตั้งค่าคุกกี้" ท้ายหน้า{' '}
            <Link to="/privacy" className="font-semibold text-foreground underline">
              นโยบายความเป็นส่วนตัว
            </Link>
          </p>
        </div>
        <div className="mt-3 grid grid-cols-3 items-stretch gap-2 md:mt-0 md:w-96 md:shrink-0">
          <Button
            variant="primary"
            className="whitespace-normal h-auto min-h-11 px-2 py-2 leading-snug"
            onClick={() => choose(true, true)}
          >
            ยอมรับทั้งหมด
          </Button>
          <Button
            variant="primary"
            className="whitespace-normal h-auto min-h-11 px-2 py-2 leading-snug"
            onClick={() => choose(false, false)}
          >
            ปฏิเสธ
          </Button>
          <Button
            variant="outline"
            className="whitespace-normal h-auto min-h-11 px-2 py-2 leading-snug"
            onClick={openSettings}
          >
            ตั้งค่า
          </Button>
        </div>
      </div>
    </div>
  );
}
