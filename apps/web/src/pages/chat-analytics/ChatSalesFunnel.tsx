import {
  STAGE_LABELS,
  type ChatAnalyticsFunnel,
  type ChatAnalyticsSales,
  type JourneyStage,
} from '@installment/shared';
import { Button } from '@/components/ui/button';
import MetricButton from './MetricButton';
import { formatDocumentAmount, analyticsDate } from './analytics-format';
export default function ChatSalesFunnel({
  funnel,
  sales,
  onFunnel,
  onSales,
  onExport,
  exporting,
}: {
  funnel: ChatAnalyticsFunnel;
  sales: ChatAnalyticsSales;
  onFunnel: (
    stage: JourneyStage,
    state: 'all' | 'reached' | 'skipped' | 'lost',
    title: string,
  ) => void;
  onSales: () => void;
  onExport: () => void;
  exporting: boolean;
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-semibold">การขายที่เชื่อมโยงกับแชท</h2>
      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        <div className="min-w-0 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-medium">Journey · ขั้นปัจจุบัน</h3>
            <Button variant="ghost" onClick={() => onFunnel('CONTACTED', 'all', 'ลูกค้าใน cohort')}>
              {funnel.customerCount} ลูกค้า
            </Button>
          </div>
          <p className="mt-1 text-sm text-muted-foreground leading-relaxed">
            {funnel.cohortDefinition}
          </p>
          <div className="mt-4 space-y-3">
            {funnel.steps.map((step) => (
              <div key={step.stage}>
                <div className="flex flex-wrap items-center justify-between gap-x-3 text-sm">
                  <button
                    className="min-h-11 text-left hover:text-primary focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onFunnel(step.stage, 'reached', STAGE_LABELS[step.stage])}
                  >
                    {STAGE_LABELS[step.stage]} <b>{step.reached}</b>
                    <span className="text-muted-foreground"> / {funnel.customerCount}</span>
                  </button>
                  <button
                    className="min-h-11 text-muted-foreground underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() =>
                      onFunnel(step.stage, 'skipped', `ข้ามขั้น ${STAGE_LABELS[step.stage]}`)
                    }
                  >
                    ข้ามขั้น {step.skipped}
                  </button>
                </div>
                <div aria-hidden className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary"
                    style={{
                      width: `${funnel.customerCount ? (step.reached / funnel.customerCount) * 100 : 0}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
          <Button
            className="mt-4"
            variant="outline"
            onClick={() => onFunnel('CONTACTED', 'lost', 'พักโอกาสขาย (ยังอยู่ใน cohort)')}
          >
            พักโอกาสขาย {funnel.lossReasons.reduce((n, r) => n + r.count, 0)} ราย
          </Button>
          <p className="mt-2 text-xs text-muted-foreground">
            {funnel.lossReasons.map((r) => `${r.reason}: ${r.count}`).join(' · ')}
          </p>
          <details className="mt-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer">หลักฐานที่ใช้และข้อจำกัด</summary>
            {funnel.scopeNotes.map((note) => (
              <p key={note} className="mt-2 leading-relaxed">
                {note}
              </p>
            ))}
          </details>
        </div>
        <div className="min-w-0 space-y-3">
          <MetricButton
            label="ยอดเอกสารที่เชื่อมโยงกับแชท"
            value={formatDocumentAmount(sales.amount)}
            hint={`${sales.documentCount} เอกสาร · ${sales.customerCount} ลูกค้า`}
            onClick={onSales}
          />
          <div className="rounded-xl border bg-card p-4 text-sm leading-relaxed">
            <p>{sales.basis}</p>
            <p className="mt-2 text-muted-foreground">
              เอกสารที่ยังเชื่อมหลักฐานแชทก่อนขายไม่ได้ {sales.unmatchedCount} ใบ ·
              ไม่ทราบเจ้าของยอด {sales.unknownSalespersonCount} ใบ
            </p>
            <p className="mt-2 text-muted-foreground">
              แสดงความเชื่อมโยง ไม่ใช่หลักฐานว่าแชทหรือโฆษณาทำให้เกิดยอดขาย
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              อ่านเมื่อ {analyticsDate(sales.observedAt)}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" onClick={onSales}>
                ดูเอกสารขาย
              </Button>
              <Button variant="outline" onClick={onExport} disabled={exporting}>
                {exporting ? 'กำลังส่งออก…' : 'ส่งออก CSV'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
