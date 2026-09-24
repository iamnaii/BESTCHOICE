import { Link } from 'react-router';
import {
  OUTCOME_LABEL,
  PAYER_LABEL,
  SOURCE_LABEL,
  STAGE_ICON,
  STAGE_LABEL,
  STAGE_TILE,
  STALE_ICON,
  baht,
  dayOf,
  staleLabel,
  type CaseRow,
} from './after-sales';

interface CaseTableProps {
  rows: CaseRow[];
}

function deviceLine(row: CaseRow) {
  return [row.deviceBrand, row.deviceModel].filter(Boolean).join(' ') || '—';
}

function outcomeLine(row: CaseRow) {
  const outcome = row.outcome ? OUTCOME_LABEL[row.outcome] : '—';
  const payer = row.repairTicket ? ` · ${PAYER_LABEL[row.repairTicket.payer]}` : '';
  return `${outcome}${payer}`;
}

function costLine(row: CaseRow) {
  const t = row.repairTicket;
  if (!t) return '—';
  if (t.actualCost != null) return baht(t.actualCost);
  if (t.estimatedCost != null) return `~${baht(t.estimatedCost)}`;
  return '—';
}

function StageChip({ row }: { row: CaseRow }) {
  const Icon = row.stale ? STALE_ICON : STAGE_ICON[row.stage];
  const label = row.stale
    ? (staleLabel(row.stage, row.daysInStage) ?? STAGE_LABEL[row.stage])
    : STAGE_LABEL[row.stage];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold leading-snug ${STAGE_TILE[row.stage]}`}
    >
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {label}
    </span>
  );
}

export default function CaseTable({ rows }: CaseTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-10 text-center">
        <p className="text-sm font-semibold leading-snug">ไม่มีเคสในแท็บนี้</p>
        <p className="mt-1 text-sm leading-snug text-muted-foreground">
          ลูกค้าเอาเครื่องมา? เริ่มที่กล่องด้านบน
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-normal">เลขเคส</th>
              <th className="px-3 py-2 text-left font-normal">ลูกค้า</th>
              <th className="px-3 py-2 text-left font-normal">เครื่อง / IMEI</th>
              <th className="px-3 py-2 text-left font-normal">ที่มา</th>
              <th className="px-3 py-2 text-left font-normal">ทางออก</th>
              <th className="px-3 py-2 text-left font-normal">ขั้นตอนตอนนี้</th>
              <th className="px-3 py-2 text-left font-normal">แจ้งเมื่อ</th>
              <th className="px-3 py-2 text-right font-normal">ค่าใช้จ่าย</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-border/60 last:border-0 hover:bg-accent">
                <td className="px-3 py-2.5">
                  <Link
                    to={`/after-sales/${row.id}`}
                    className="font-semibold text-primary hover:underline"
                  >
                    {row.caseNumber}
                  </Link>
                </td>
                <td className="px-3 py-2.5">
                  <div>{row.customer.name}</div>
                  <div className="text-xs text-muted-foreground">{row.customer.phone ?? '—'}</div>
                </td>
                <td className="px-3 py-2.5">
                  <div>{deviceLine(row)}</div>
                  <div className="text-xs text-muted-foreground">{row.deviceImei ?? '—'}</div>
                </td>
                <td className="px-3 py-2.5">
                  <span className="inline-block rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold leading-snug">
                    {SOURCE_LABEL[row.source]}
                  </span>
                </td>
                <td className="px-3 py-2.5">{outcomeLine(row)}</td>
                <td className="px-3 py-2.5">
                  <StageChip row={row} />
                </td>
                <td className="px-3 py-2.5">
                  <div>{dayOf(row.receivedAt)}</div>
                  <div className="text-xs text-muted-foreground">{row.receivedBy.name}</div>
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums">{costLine(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 md:hidden">
        {rows.map((row) => (
          <Link
            key={row.id}
            to={`/after-sales/${row.id}`}
            className="block rounded-lg border border-border bg-card p-3 text-sm hover:bg-accent"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-primary">{row.caseNumber}</span>
              <StageChip row={row} />
            </div>
            <div className="mt-1.5 leading-snug">
              {row.customer.name} · {deviceLine(row)}
            </div>
            <div className="mt-1 text-xs leading-snug text-muted-foreground">
              {outcomeLine(row)} · {SOURCE_LABEL[row.source]} · {dayOf(row.receivedAt)}
            </div>
          </Link>
        ))}
      </div>
    </>
  );
}
