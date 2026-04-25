import { useEffect, useState } from 'react';
import { Info, X } from 'lucide-react';

const STORAGE_KEY = 'collections-migrated-banner-dismissed';
// Hardcoded deploy date — banner stops showing 14 days after this date.
// Update this when re-deploying or running another migration nudge.
const DEPLOY_DATE = new Date('2026-04-25');
const DAYS_VISIBLE = 14;

function shouldShow(now: Date, dismissed: boolean): boolean {
  if (dismissed) return false;
  const cutoff = new Date(DEPLOY_DATE);
  cutoff.setDate(cutoff.getDate() + DAYS_VISIBLE);
  return now < cutoff;
}

export default function MigrationBanner() {
  // Read once on mount so SSR/hydration mismatch isn't a concern; localStorage
  // is only available in the browser.
  const [visible, setVisible] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const dismissed = window.localStorage.getItem(STORAGE_KEY) === '1';
    return shouldShow(new Date(), dismissed);
  });

  // Re-evaluate on focus/route change in case user kept tab open across the cutoff.
  useEffect(() => {
    const onFocus = () => {
      const dismissed = window.localStorage.getItem(STORAGE_KEY) === '1';
      setVisible(shouldShow(new Date(), dismissed));
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    window.localStorage.setItem(STORAGE_KEY, '1');
    setVisible(false);
  };

  return (
    <div
      role="status"
      className="mb-4 flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm leading-snug"
    >
      <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <div className="flex-1">
        <p className="font-medium text-foreground">
          ย้ายจาก /overdue มาที่ /collections แล้ว อัปเดต bookmark ได้เลย
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          หน้าเดิมจะ redirect อัตโนมัติ — ฟีเจอร์ทั้งหมดอยู่ที่นี่ครบ
        </p>
      </div>
      <button
        onClick={dismiss}
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        aria-label="ปิดประกาศ"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
