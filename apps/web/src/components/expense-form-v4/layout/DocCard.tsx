import type { ReactNode } from 'react';

/** การ์ดใหญ่ใบเดียวของหน้าเอกสาร — แถวข้างในคั่นกันด้วยเส้นของ FormRow */
export function DocCard({ banner, children }: { banner?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-xl border border-border bg-card px-4 sm:px-6">
      {banner && <div className="pt-4">{banner}</div>}
      {children}
    </div>
  );
}
