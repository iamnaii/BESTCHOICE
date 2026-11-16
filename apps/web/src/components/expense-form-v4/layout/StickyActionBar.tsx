import type { ReactNode } from 'react';

interface Props {
  summary: ReactNode;
  /** ข้อความแจ้งเตือน — อยู่เหนือแถวปุ่มเสมอ ไม่ถูกแถบบัง */
  notices?: ReactNode;
  children: ReactNode;
}

/** แถบปุ่มติดขอบล่างจอ · ขอบซ้ายขวาติดลบเท่า padding ของ PageShell (px-4 / lg:px-7) */
export function StickyActionBar({ summary, notices, children }: Props) {
  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-6 border-t border-border bg-background lg:-mx-7">
      {notices}
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:px-7">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm leading-snug">{summary}</div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap">{children}</div>
      </div>
    </div>
  );
}
