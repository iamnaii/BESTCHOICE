import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft } from '@/lib/icons';
import SellContactLinks from './SellContactLinks';
import './sell-flow.css';

export default function SellFlowLayout({
  title,
  progressText,
  onBack,
  footer,
  transitioning = false,
  wide = false,
  children,
}: {
  title: string;
  progressText: string;
  onBack?: () => void;
  footer?: ReactNode;
  transitioning?: boolean;
  wide?: boolean;
  children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    if (window.scrollY > 0) window.scrollTo?.({ top: 0, behavior: 'instant' });
  }, [title, progressText]);
  return (
    <div className="sell-flow min-h-dvh bg-sell-canvas text-foreground leading-snug py-0 min-[700px]:py-8">
      <div
        className={`mx-auto flex min-h-dvh w-full flex-col bg-card min-[700px]:min-h-[min(560px,calc(100dvh-64px))] ${wide ? 'min-[700px]:max-w-[1100px]' : 'min-[700px]:max-w-[640px]'} min-[700px]:overflow-hidden min-[700px]:rounded-3xl min-[700px]:shadow-xl min-[700px]:border min-[700px]:border-border`}
      >
        <header className="border-b border-border bg-card text-sell-header-foreground">
          <div className="flex items-center gap-3 border-t-[3px] border-primary bg-secondary px-6 py-3.5 min-[700px]:px-8">
            <img
              src="/logo-icon.svg"
              alt=""
              aria-hidden="true"
              width={48}
              height={48}
              className="size-12 shrink-0"
            />
            <div className="min-w-0">
              <p className="text-[22px] font-bold tracking-wide text-ink min-[700px]:text-[24px]">
                BESTCHOICE
              </p>
              <p className="text-[13px] font-medium text-secondary-foreground">
                เบสท์ช้อยส์ · ลพบุรี
              </p>
            </div>
            <span className="ml-auto hidden rounded-full border border-border bg-card px-3 py-1.5 text-xs font-semibold text-secondary-foreground min-[700px]:inline-block">
              ขาย / เทิร์น iPhone
            </span>
          </div>
          <div className="flex min-h-[52px] items-center gap-3 px-6 py-1 min-[700px]:px-8">
            {onBack ? (
              <button
                type="button"
                onClick={onBack}
                aria-label="ย้อนกลับ"
                className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border text-sell-header-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <ArrowLeft size={20} aria-hidden="true" />
              </button>
            ) : (
              <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
            )}
            <p className="text-sm font-semibold text-secondary-foreground">{progressText}</p>
          </div>
        </header>
        <main className="min-w-0 flex-1 px-6 py-6 min-[700px]:px-8 min-[700px]:py-7">
          <div key={`${title}|${progressText}`} className="sell-step-content">
            <h1
              ref={heading}
              tabIndex={-1}
              className="mb-5 text-[26px] font-bold leading-snug outline-none"
            >
              {title}
            </h1>
            {children}
          </div>
        </main>
        <p role="status" className="sr-only">
          {transitioning ? 'กำลังไปต่อ…' : ''}
        </p>
        <footer className="bg-sell-footer border-t border-border px-4 pt-2 pb-[max(16px,env(safe-area-inset-bottom))] min-[700px]:px-6">
          {footer ?? <SellContactLinks />}
        </footer>
      </div>
    </div>
  );
}
