import type { ChatResponseMetrics, ChatCycleMetric } from '@installment/shared';
import MetricButton from './MetricButton';
export default function ResponseMetrics({
  data,
  onDrill,
}: {
  data: ChatResponseMetrics;
  onDrill: (metric: ChatCycleMetric, title: string) => void;
}) {
  return (
    <section className="space-y-3" aria-labelledby="response-heading">
      <div>
        <h2 id="response-heading" className="font-semibold">
          ความเร็วตอบของคนกับบอท
        </h2>
        <p className="text-sm text-muted-foreground">
          นับรอบที่เริ่มในช่วงวันที่ และคำตอบที่ยืนยันถึงเวลาที่แสดง · นาทีตามเวลาทำงาน
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            ['คน · ค่ากลาง (median)', data.humanMedianMinutes, 'HUMAN_SAMPLES', data.humanSamples],
            ['คน · p90', data.humanP90Minutes, 'HUMAN_SAMPLES', data.humanSamples],
            ['บอท · ค่ากลาง (median)', data.botMedianMinutes, 'BOT_SAMPLES', data.botSamples],
            ['บอท · p90', data.botP90Minutes, 'BOT_SAMPLES', data.botSamples],
          ] as const
        ).map(([label, value, metric, samples]) => (
          <MetricButton
            key={label}
            label={label}
            value={value}
            unit="นาที"
            hint={`${samples} ตัวอย่างจาก ${data.cycles} รอบ`}
            onClick={() => onDrill(metric, label)}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg border bg-card px-3 py-2 text-sm">
        {(
          [
            ['รอบทั้งหมด', data.cycles, 'ALL'],
            ['ห้องแชท', data.rooms, 'ROOMS'],
            ['คนตอบแล้ว', data.nResponded, 'RESPONDED'],
            ['ยังรอคนตอบ', data.nAwaiting, 'AWAITING'],
            ['ปิดโดยไม่ตอบ', data.nResolvedWithoutReply, 'RESOLVED'],
            [`เกินเกณฑ์จาก ${data.slaSamples} รอบที่วัดได้`, data.slaBreached, 'SLA'],
          ] as const
        ).map(([label, value, metric]) => (
          <button
            type="button"
            key={metric}
            className="min-h-11 text-left underline decoration-border underline-offset-4 hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => onDrill(metric, label)}
          >
            {label} <b className="tabular-nums">{value}</b>
          </button>
        ))}
      </div>
    </section>
  );
}
