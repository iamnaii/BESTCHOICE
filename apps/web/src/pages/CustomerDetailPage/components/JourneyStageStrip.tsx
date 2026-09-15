import { Check } from 'lucide-react';
import { JOURNEY_LOST_REASON_LABELS, STAGE_LABELS, type JourneyStep, type JourneySummary } from '@installment/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDateShort } from '@/utils/formatters';
import { SILENT_AFTER_DAYS } from '../utils/journeyGroups';

const DOT_CLASS: Record<JourneyStep['state'], string> = {
  done: 'bg-success text-success-foreground',
  current: 'bg-primary text-primary-foreground',
  skipped: 'bg-muted text-muted-foreground',
  todo: 'border border-dashed border-border bg-background text-muted-foreground',
};

function skippedCaption(path: JourneySummary['path']): string {
  if (path === 'CASH') return 'ข้าม (เงินสด)';
  if (path === 'EXTERNAL_FINANCE') return 'ข้าม (ไฟแนนซ์นอก)';
  return 'ข้าม';
}

function stepCaption(step: JourneyStep, summary: JourneySummary, failed: boolean): string {
  if (step.state === 'skipped') return skippedCaption(summary.path);
  if (step.state === 'todo') return 'ยังไม่ถึง';
  const parts = [step.at ? formatDateShort(step.at) : '—'];
  if (failed) parts.push('เครดิตไม่ผ่าน');
  else if (step.state === 'current' && step.stage !== 'PURCHASED') parts.push(`อยู่ขั้นนี้ ${summary.daysInStage} วัน`);
  if (step.evidence === 'MANUAL') parts.push('พนักงานบันทึก');
  return parts.join(' · ');
}

function lostLabel(reason: string): string {
  // รหัสที่ไม่มีใน shared แสดงแค่ "หลุด" ไม่แสดงค่าดิบ
  const label = JOURNEY_LOST_REASON_LABELS[reason];
  return label ? `หลุด · ${label}` : 'หลุด';
}

/** แถบ 5 ขั้นใต้ช่องตัวเลข — อ่านจาก summary เท่านั้น ห้าม derive ขั้นในเว็บ */
export default function JourneyStageStrip({ summary }: { summary: JourneySummary }) {
  const silentDays = summary.silentDays !== null && summary.silentDays > SILENT_AFTER_DAYS ? summary.silentDays : null;

  return (
    <section
      aria-label="ขั้นการเดินทางของลูกค้า"
      className="mb-5 rounded-xl border border-border/50 bg-card px-4 py-3 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ol className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-2">
          {summary.steps.map((step, index) => {
            const failed =
              step.stage === 'CREDIT' && summary.creditRejected && step.state !== 'todo' && step.state !== 'skipped';
            const muted = step.state === 'todo' || step.state === 'skipped';
            return (
              <li
                key={step.stage}
                data-stage={step.stage}
                data-state={step.state}
                aria-current={step.state === 'current' ? 'step' : undefined}
                className="flex min-w-[9rem] flex-1 items-center gap-2"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums',
                    failed ? 'bg-destructive text-destructive-foreground' : DOT_CLASS[step.state],
                  )}
                >
                  {step.state === 'done' && !failed ? <Check className="size-3.5" /> : index + 1}
                </span>
                <span className="min-w-0">
                  <span
                    className={cn(
                      'block truncate text-[13px] font-medium leading-snug',
                      muted ? 'text-muted-foreground' : 'text-foreground',
                    )}
                  >
                    {STAGE_LABELS[step.stage]}
                  </span>
                  <span
                    className={cn('block truncate text-xs leading-snug', failed ? 'text-destructive' : 'text-muted-foreground')}
                  >
                    {stepCaption(step, summary, failed)}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        {(summary.lost || silentDays !== null) && (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5">
            {summary.lost && (
              <Badge variant="destructive" appearance="light" size="md" className="leading-snug">
                {lostLabel(summary.lost.reason)}
              </Badge>
            )}
            {silentDays !== null && (
              <Badge variant="warning" appearance="light" size="md" className="leading-snug">
                {`เงียบ ${silentDays} วัน`}
              </Badge>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
