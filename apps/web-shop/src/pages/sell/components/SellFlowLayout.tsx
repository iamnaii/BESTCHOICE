import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import SellContactLinks from './SellContactLinks';
import './sell-flow.css';

export default function SellFlowLayout({
  title,
  progressText,
  onBack,
  footer,
  transitioning = false,
  children,
}: {
  title: string;
  progressText: string;
  onBack?: () => void;
  footer?: ReactNode;
  transitioning?: boolean;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    if (window.scrollY > 0) window.scrollTo?.({ top: 0, behavior: 'instant' });
  }, [title, progressText]);
  return (
    <div className="sell-flow min-h-dvh bg-sell-canvas text-foreground leading-snug py-0 min-[700px]:py-8">
      <div className="mx-auto flex min-h-dvh w-full flex-col bg-card min-[700px]:min-h-[min(560px,calc(100dvh-64px))] min-[700px]:max-w-[640px] min-[700px]:overflow-hidden min-[700px]:rounded-3xl min-[700px]:shadow-xl min-[700px]:border min-[700px]:border-border">
        <header className="flex items-center gap-3 bg-ink text-ink-foreground px-4 py-3 min-[700px]:px-6">
          {onBack ? (
            <button
              type="button"
              onClick={onBack}
              aria-label="ย้อนกลับ"
              className="flex size-11 shrink-0 items-center justify-center rounded-full border border-ink-foreground/40 text-ink-foreground hover:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink-foreground"
            >
              <ArrowLeft size={20} aria-hidden="true" />
            </button>
          ) : (
            <span className="size-11 shrink-0" aria-hidden="true" />
          )}
          <div>
            <p className="font-semibold">เบสท์ช้อยส์ · ลพบุรี</p>
            <p className="mt-1 text-sm text-emerald-100">{progressText}</p>
          </div>
        </header>
        <main className="min-w-0 flex-1 px-6 py-6 min-[700px]:px-8 min-[700px]:py-7">
          <div key={`${title}|${progressText}`} className="sell-step-content">
            <h1
              ref={heading}
              tabIndex={-1}
              className="mb-5 text-[26px] font-bold leading-snug outline-none min-[700px]:text-[28px]"
            >
              {title}
            </h1>
            {children}
          </div>
        </main>
        <p role="status" className="sr-only">
          {transitioning ? 'กำลังไปต่อ…' : ''}
        </p>
        <footer className="bg-sell-canvas border-t border-border px-4 pt-2 pb-[max(16px,env(safe-area-inset-bottom))] min-[700px]:px-6">
          {footer ?? <SellContactLinks />}
        </footer>
      </div>
    </div>
  );
}
