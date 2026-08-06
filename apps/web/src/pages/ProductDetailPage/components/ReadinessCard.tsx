import { Check, X, Info } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ProductReadinessResponse } from '../hooks/useProductReadiness';

interface Props {
  isLoading: boolean;
  isError: boolean;
  data: ProductReadinessResponse | undefined;
}

export default function ReadinessCard({ isLoading, isError, data }: Props) {
  if (isLoading) {
    return (
      <div className="bg-card rounded-lg border p-4 text-sm text-muted-foreground leading-snug">
        กำลังตรวจสถานะขึ้นเว็บ...
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="bg-card rounded-lg border p-4 text-sm text-muted-foreground leading-snug">
        ตรวจสถานะขึ้นเว็บไม่สำเร็จ
      </div>
    );
  }

  return (
    <div className="bg-card rounded-lg border p-4">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h2 className="text-sm font-semibold text-foreground leading-snug">สถานะขึ้นเว็บ</h2>
        <Badge variant={data.isReady ? 'success' : 'warning'} appearance="light" size="sm">
          {data.isReady ? 'พร้อมขึ้นเว็บ' : 'ยังขึ้นเว็บไม่ได้'}
        </Badge>
      </div>
      <ul className="space-y-1.5">
        {data.checks.map((check) =>
          // severity: 'info' (เช่น isDemo) คือข้อมูลประกอบ ไม่ใช่เงื่อนไข pass/fail —
          // render เป็น note ด้วยไอคอนกลาง ไม่ใช้ ✓/✗
          check.severity === 'info' ? (
            <li key={check.key} className="flex items-start gap-2 text-sm leading-snug">
              <Info className="size-4 mt-0.5 shrink-0 text-muted-foreground" aria-label="ข้อมูลเพิ่มเติม" />
              <span className="text-muted-foreground">
                {check.label}
                {check.hint && <span className="block text-xs text-muted-foreground">{check.hint}</span>}
              </span>
            </li>
          ) : (
            <li key={check.key} className="flex items-start gap-2 text-sm leading-snug">
              {check.ok ? (
                <Check className="size-4 mt-0.5 shrink-0 text-success" aria-label="ผ่าน" />
              ) : (
                <X className="size-4 mt-0.5 shrink-0 text-destructive" aria-label="ยังไม่ผ่าน" />
              )}
              <span className={check.ok ? 'text-foreground' : 'text-muted-foreground'}>
                {check.label}
                {!check.ok && check.hint && (
                  <span className="block text-xs text-muted-foreground">{check.hint}</span>
                )}
              </span>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}
