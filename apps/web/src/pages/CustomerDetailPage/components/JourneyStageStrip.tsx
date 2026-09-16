import { Check } from 'lucide-react';
import { JOURNEY_LOST_REASON_LABELS, STAGE_LABELS, type JourneyStep, type JourneySummary } from '@installment/shared';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { formatDateShort } from '@/utils/formatters';
import { SILENT_AFTER_DAYS } from '../utils/journeyGroups';
import JourneyLostControls from './JourneyLostControls';

/** เว้นวรรคแบบไม่ตัดบรรทัด — เลขกับคำว่า "วัน" อยู่บรรทัดเดียวกันเสมอเมื่อคำบรรยายขึ้น 2 บรรทัด (คำตัดสินเจ้าของ 2026-09-15 ข้อ 12) */
const NBSP = ' ';

const DOT_CLASS: Record<JourneyStep['state'], string> = {
  done: 'bg-success text-success-foreground',
  current: 'bg-primary text-primary-foreground',
  skipped: 'bg-muted text-muted-foreground',
  // "ไม่ต้องตรวจ" ใช้เทาชุดเดียวกับข้าม (ไม่เพิ่มสีใหม่) — ต่างกันที่คำบรรยาย · จุดยังแสดงเลขขั้น
  not_needed: 'bg-muted text-muted-foreground',
  todo: 'border border-dashed border-border bg-background text-muted-foreground',
};

/** ชื่อขั้นสีจาง: ยังไม่ถึง · ข้าม · ไม่ต้องตรวจ */
const MUTED_STATES: ReadonlySet<JourneyStep['state']> = new Set<JourneyStep['state']>(['todo', 'skipped', 'not_needed']);

/** API ตั้ง not_needed เฉพาะขั้นตรวจเครดิตของลูกค้าที่ซื้อแล้วแบบเงินสด / ไฟแนนซ์นอก (D1) — path อื่นไม่ควรเกิด จึงใช้คำกลาง "ข้าม" */
function notNeededCaption(path: JourneySummary['path']): string {
  if (path === 'CASH') return 'ไม่ต้องตรวจ (ซื้อสด)';
  if (path === 'EXTERNAL_FINANCE') return 'ไฟแนนซ์นอกตรวจ';
  return 'ข้าม';
}

function stepCaption(step: JourneyStep, summary: JourneySummary, failed: boolean): string {
  // ขั้นก่อนขั้นปัจจุบันที่ไม่มีหลักฐาน = "ข้าม" เปล่า ๆ ทุกขั้น (คำตัดสิน 13(2) — เลิกวงเล็บต่อท้ายตาม path)
  if (step.state === 'skipped') return 'ข้าม';
  if (step.state === 'not_needed') return notNeededCaption(summary.path);
  if (step.state === 'todo') return 'ยังไม่ถึง';
  const parts = [step.at ? formatDateShort(step.at) : '—'];
  if (failed) parts.push('เครดิตไม่ผ่าน');
  else if (step.state === 'current' && step.stage !== 'PURCHASED') parts.push(`อยู่ขั้นนี้ ${summary.daysInStage}${NBSP}วัน`);
  if (step.evidence === 'MANUAL') parts.push('พนักงานบันทึก');
  // ไฟล์ในแชทพาขึ้นขั้นอย่างเดียว ผลตรวจมาจากใบตรวจเครดิต — เครดิตไม่ผ่านแสดงแค่ผล (บอร์ด StageStrip a4)
  if (step.evidence === 'CHAT_FILE' && !failed) parts.push('ส่งไฟล์ในแชท');
  return parts.join(' · ');
}

function lostLabel(reason: string): string {
  // รหัสที่ไม่มีใน shared แสดงแค่ "หลุด" ไม่แสดงค่าดิบ
  const label = JOURNEY_LOST_REASON_LABELS[reason];
  return label ? `หลุด · ${label}` : 'หลุด';
}

export interface JourneyStageStripProps {
  summary: JourneySummary;
  customerId: string;
  /** บทบาทที่บันทึกการเดินทางได้ (canRecordJourney) — ACCOUNTANT = false ไม่มีปุ่มใด ๆ */
  canRecord: boolean;
}

/** แถบ 5 ขั้นใต้ช่องตัวเลข — อ่านจาก summary เท่านั้น ห้าม derive ขั้นในเว็บ */
export default function JourneyStageStrip({ summary, customerId, canRecord }: JourneyStageStripProps) {
  const silentDays = summary.silentDays !== null && summary.silentDays > SILENT_AFTER_DAYS ? summary.silentDays : null;
  const showControls = canRecord && summary.stage !== 'PURCHASED';

  return (
    <section
      aria-label="ขั้นการเดินทางของลูกค้า"
      className="mb-5 rounded-xl border border-border/50 bg-card px-4 py-3 shadow-sm"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <ol className="flex min-w-0 flex-1 flex-wrap gap-x-4 gap-y-2">
          {summary.steps.map((step, index) => {
            const failed =
              step.stage === 'CREDIT' && summary.creditRejected && (step.state === 'done' || step.state === 'current');
            const muted = MUTED_STATES.has(step.state);
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
                  {/* Q15: คำบรรยายขึ้น 2 บรรทัด ไม่ตัดข้อมูล — ชื่อขั้นยังบรรทัดเดียว */}
                  <span className={cn('line-clamp-2 text-xs leading-snug', failed ? 'text-destructive' : 'text-muted-foreground')}>
                    {stepCaption(step, summary, failed)}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
        {(summary.lost || silentDays !== null || showControls) && (
          <div
            data-testid="journey-stage-actions"
            className="flex shrink-0 flex-wrap items-center gap-1.5 max-lg:w-full max-lg:justify-end"
          >
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
            {showControls && <JourneyLostControls customerId={customerId} summary={summary} />}
          </div>
        )}
      </div>
    </section>
  );
}
