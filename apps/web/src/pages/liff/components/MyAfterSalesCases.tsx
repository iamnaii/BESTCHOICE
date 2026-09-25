import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { liffApi } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateTime } from '@/utils/formatters';

// เว็บคอปปี้ของ API contract (Task 6 — `apps/api/src/modules/line-oa/liff-after-sales.service.ts`)
export interface LiffAfterSalesStep {
  title: string;
  state: 'done' | 'now' | 'idle';
  hint: string | null;
}

export interface LiffAfterSalesCase {
  caseNumber: string;
  outcome: 'REPAIR' | 'SAME_MODEL_EXCHANGE' | 'PRICED_EXCHANGE' | 'CASH_SAME_MODEL_EXCHANGE' | null;
  stageLabel: string;
  deviceName: string;
  branchName: string;
  steps: LiffAfterSalesStep[];
  updatedAt: string;
  costLine: string;
}

export interface LiffAfterSalesResponse {
  linked: boolean;
  cases: LiffAfterSalesCase[];
}

// ตาม frontend.md: ชิปสีต้องมีข้อความเสมอ (ห้ามสื่อความหมายด้วยสีอย่างเดียว) และใช้ token เท่านั้น
const WARNING_STAGE_LABELS = new Set(['กำลังซ่อม', 'รอผู้จัดการยืนยัน', 'รออนุมัติ', 'รับเรื่องแล้ว']);
const PRIMARY_STAGE_LABELS = new Set(['รอรับเครื่อง']);

function stageChipClass(label: string): string {
  if (WARNING_STAGE_LABELS.has(label)) return 'bg-warning/10 text-warning-strong';
  if (PRIMARY_STAGE_LABELS.has(label)) return 'bg-primary/10 text-primary';
  // ปิดเคส / ยกเลิก / ป้ายที่ไม่รู้จัก → เทากลาง
  return 'bg-muted text-muted-foreground';
}

function StageChip({ label }: { label: string }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium leading-snug ${stageChipClass(label)}`}
    >
      {label}
    </span>
  );
}

function StepList({ steps }: { steps: LiffAfterSalesStep[] }) {
  return (
    <ol aria-label="ขั้นตอน" className="space-y-2">
      {steps.map((step, i) => (
        <li
          key={i}
          className="flex items-start gap-2.5"
          aria-current={step.state === 'now' ? 'step' : undefined}
        >
          {step.state === 'done' ? (
            <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
              <Check className="size-3.5" aria-hidden="true" />
            </span>
          ) : (
            <span
              className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-[0.6875rem] font-semibold ${
                step.state === 'now'
                  ? 'bg-warning text-warning-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {i + 1}
            </span>
          )}
          <span className="text-sm leading-snug">
            <span className={step.state === 'idle' ? 'text-muted-foreground' : 'text-foreground'}>
              {step.title}
            </span>
            {step.state === 'now' && step.hint && (
              <span className="block text-xs text-muted-foreground leading-snug">{step.hint}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** ส่วน "เคสของฉัน" ในหน้า /liff/warranty — วางเหนือ "ประกันของฉัน" เฉพาะเมื่อผูกบัญชีแล้ว
 * (ผู้เรียกเป็นคนตัดสิน `data?.linked` — คอมโพเนนต์นี้ซ่อนตัวเองเมื่อ error/ไม่มีเคส) */
export default function MyAfterSalesCases({ lineId }: { lineId: string }) {
  const { data, isLoading, error } = useQuery<LiffAfterSalesResponse>({
    queryKey: ['liff-after-sales-cases', lineId],
    queryFn: async () => {
      const { data } = await liffApi.get('/line-oa/liff/my-after-sales-cases');
      return data;
    },
    enabled: !!lineId,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-6 w-28 rounded" />
        <Skeleton className="h-28 w-full rounded-xl" />
      </div>
    );
  }

  // error หรือยังไม่ผูกบัญชี หรือไม่มีเคส → ไม่แสดงส่วนนี้เลย (หน้าประกันยังเป็นหลัก;
  // 401 ถูก liffApi interceptor จัดการเองอยู่แล้ว)
  if (error || !data?.linked || data.cases.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <h2 className="px-1 text-lg font-bold text-foreground leading-snug">เคสของฉัน</h2>
      {data.cases.map((c) => (
        <Card key={c.caseNumber}>
          <CardContent className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="font-semibold text-foreground leading-snug">{c.caseNumber}</div>
              <StageChip label={c.stageLabel} />
            </div>

            <div className="text-sm text-muted-foreground leading-snug">
              {c.deviceName} · {c.branchName}
            </div>

            <div className="border-t border-border pt-3">
              <StepList steps={c.steps} />
            </div>

            <div className="text-xs text-muted-foreground leading-snug">
              อัปเดตล่าสุด {formatDateTime(c.updatedAt)} · ค่าใช้จ่าย: {c.costLine}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
