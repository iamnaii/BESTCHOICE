import { useEffect, useRef, type ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';

export default function SellFlowLayout({ title, progressText, onBack, footer, children }: {
  title: string; progressText: string; onBack?: () => void; footer?: ReactNode; children: ReactNode;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    window.scrollTo?.({ top: 0, behavior: 'instant' });
  }, [title, progressText]);
  return <div className="min-h-dvh bg-background text-foreground leading-snug py-0 min-[700px]:py-8">
    <div className="mx-auto flex min-h-dvh w-full flex-col bg-card min-[700px]:min-h-[min(680px,calc(100dvh-64px))] min-[700px]:max-w-[560px] min-[700px]:rounded-3xl min-[700px]:border min-[700px]:border-border">
      <header className="flex items-center gap-3 border-b border-border px-4 py-4 min-[700px]:px-6">
        {onBack && <button type="button" onClick={onBack} aria-label="ย้อนกลับ" className="flex size-11 shrink-0 items-center justify-center rounded-full border border-border text-secondary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"><ArrowLeft size={20} aria-hidden="true" /></button>}
        <div><p className="font-semibold">เบสท์ช้อยส์ · ลพบุรี</p><p className="mt-1 text-sm text-foreground">{progressText}</p></div>
      </header>
      <main className="min-w-0 flex-1 px-6 py-6 min-[700px]:px-8 min-[700px]:py-7">
        <h1 ref={heading} tabIndex={-1} className="mb-5 text-[26px] font-bold leading-snug outline-none min-[700px]:text-[28px]">{title}</h1>
        {children}
      </main>
      {footer && <footer className="sticky bottom-0 z-10 border-t border-border bg-card px-6 pt-3 pb-[max(18px,env(safe-area-inset-bottom))] min-[700px]:px-8">{footer}</footer>}
    </div>
  </div>;
}
