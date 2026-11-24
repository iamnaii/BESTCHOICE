import { Check, X, Info } from '@/lib/icons';
import { Badge } from '@/components/ui/badge';
import type { ProductReadinessCheck, ProductReadinessResponse } from '../hooks/useProductReadiness';

interface Props {
  isLoading: boolean;
  isError: boolean;
  data: ProductReadinessResponse | undefined;
  onRetry?: () => void;
  onFix?: (key: string) => void;
  availableActions?: string[];
}

export default function ReadinessCard({ isLoading, isError, data, onRetry, onFix, availableActions }: Props) {
  if (isLoading) return <div role="status" className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">กำลังตรวจสถานะขึ้นเว็บ...</div>;
  if (isError || !data) return <div role="alert" className="rounded-xl border bg-card p-5 text-sm">
    ตรวจสถานะขึ้นเว็บไม่สำเร็จ
    {onRetry && <button type="button" onClick={onRetry} className="block min-h-11 text-primary underline">ลองใหม่</button>}
  </div>;
  const failed = data.checks.filter(c => c.severity === 'blocking' && !c.ok);
  const passed = data.checks.filter(c => c.severity === 'blocking' && c.ok);
  const notes = data.checks.filter(c => c.severity === 'info');
  const actions: Record<string, string> = { gallery: 'เพิ่มรูปสินค้า', cashPrice: 'ตั้งราคาขาย', isOnlineVisible: 'ไปที่สวิตช์' };
  const row = (check: ProductReadinessCheck) => <li key={check.key} className="flex items-start gap-2 text-sm leading-snug">
    {check.severity === 'info' ? <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-label="ข้อมูลเพิ่มเติม" />
      : check.ok ? <Check className="mt-0.5 size-4 shrink-0 text-success" aria-label="ผ่าน" />
      : <X className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="ยังไม่ผ่าน" />}
    <div className="min-w-0 flex-1">
      <span>{check.label}</span>
      {check.hint && (!check.ok || check.severity === 'info') && <p className="mt-1 text-xs text-muted-foreground">{check.hint}</p>}
      {!check.ok && actions[check.key] && onFix && (!availableActions || availableActions.includes(check.key)) && <button type="button" onClick={() => onFix(check.key)} className="mt-1 min-h-11 rounded-md px-2 text-sm text-primary underline hover:bg-accent">{actions[check.key]}</button>}
    </div>
  </li>;
  return <section className="space-y-4 rounded-xl border bg-card p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold">สถานะขึ้นเว็บ</h2>
      <Badge variant={data.isReady ? 'success' : 'warning'} appearance="light" size="sm">{data.isReady ? 'พร้อมขึ้นเว็บ' : 'ยังขึ้นเว็บไม่ได้'}</Badge>
    </div>
    {failed.length > 0 && <div className="space-y-3"><p className="text-sm font-medium">ต้องแก้อีก {failed.length} รายการ</p><ul className="space-y-3">{failed.map(row)}</ul></div>}
    {passed.length > 0 && <details><summary className="min-h-11 cursor-pointer text-sm text-muted-foreground">ผ่านแล้ว {passed.length} รายการ · ดูรายละเอียด</summary><ul className="space-y-2">{passed.map(row)}</ul></details>}
    {notes.length > 0 && <ul className="space-y-2 border-t pt-3">{notes.map(row)}</ul>}
  </section>;
}
