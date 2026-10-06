import { Link } from 'react-router';
import { ShieldAlert, UserCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  APPROVER_LABEL,
  DEVICE_SWAP_CLOSED_SHORT,
  EXCHANGE_KIND_LABEL,
  TIER_LABEL,
  baht,
  dayOf,
  type CaseExchangeInfo,
  type CaseRow,
  type ExchangeApproverRole,
} from './after-sales';

/**
 * Task 12 — ตารางแท็บ "รออนุมัติ" (mockup C). Presentational เท่านั้น: ไม่มี query/dialog เอง —
 * หน้า AfterSalesPage เป็นคนถือ dialog state + navigate (ดู jsdoc ของ onAction ด้านล่าง).
 */
export type ApprovalAction = 'confirm' | 'reject' | 'open';

interface ApprovalTableProps {
  rows: CaseRow[];
  role: string;
  onAction: (row: CaseRow, action: ApprovalAction) => void;
}

const MGR_ROLES = new Set(['OWNER', 'BRANCH_MANAGER']);

function productLabel(p: CaseExchangeInfo['oldProduct']): string {
  return p ? [p.brand, p.model, p.storage].filter(Boolean).join(' ') : '—';
}

function deviceLine(ex: CaseExchangeInfo): string {
  const old = productLabel(ex.oldProduct);
  if (!ex.newProduct) return `${old} · ยังไม่เลือก`;
  return `${old} → ${productLabel(ex.newProduct)}`;
}

/** "รับซื้อ X · Y% ของยอดคงเหลือ" เมื่อมีทั้งราคารับซื้อและยอดคงเหลือ (NCV) — Y = round(buyback/ncv*100) */
function buybackLine(ex: CaseExchangeInfo): string | null {
  if (!ex.buybackPrice || !ex.ncvSnapshot) return null;
  const ncv = Number(ex.ncvSnapshot);
  if (!ncv) return null;
  const pct = Math.round((Number(ex.buybackPrice) / ncv) * 100);
  return `รับซื้อ ${baht(ex.buybackPrice)} · ${pct}% ของยอดคงเหลือ`;
}

function TypePriceCell({ ex }: { ex: CaseExchangeInfo | null }) {
  if (!ex) return <span className="text-muted-foreground">—</span>;
  const buyback = buybackLine(ex);
  return (
    <div className="space-y-1">
      <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold leading-snug text-foreground">
        {EXCHANGE_KIND_LABEL[ex.kind]}
        {ex.approvalTier ? ` · ${TIER_LABEL[ex.approvalTier]}` : ''}
      </span>
      {buyback && <p className="text-xs leading-snug text-muted-foreground">{buyback}</p>}
    </div>
  );
}

/** ป้าย "ใครอนุมัติได้" — แถว SAME_MODEL ตามผู้อนุมัติของคำขอ · แถว PRICED = "ปิดใช้แล้ว" (2026-10-06; เดิม T12-1 ต่อท้าย tier) */
function ApproverChip({ ex }: { ex: CaseExchangeInfo | null }) {
  // 2026-10-06 — แถว PRICED ไม่มีใครอนุมัติได้อีก (เมนูปิด) — ป้ายกลาง ๆ แทน tier/ผู้อนุมัติ ที่จะขัดกับข้อความปิดใช้ในช่องการกระทำ
  if (ex?.kind === 'PRICED') {
    return (
      <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-semibold leading-snug text-muted-foreground">
        ปิดใช้แล้ว
      </span>
    );
  }
  const approverRole: ExchangeApproverRole = ex?.approverRole ?? 'OWNER';
  if (approverRole === 'OWNER') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2.5 py-0.5 text-xs font-semibold leading-snug text-destructive">
        <ShieldAlert aria-hidden className="h-3.5 w-3.5 shrink-0" />
        {APPROVER_LABEL.OWNER}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2.5 py-0.5 text-xs font-semibold leading-snug text-warning-strong">
      <UserCheck aria-hidden className="h-3.5 w-3.5 shrink-0" />
      {APPROVER_LABEL.BRANCH_MANAGER}
    </span>
  );
}

function ActionsCell({
  row,
  role,
  onAction,
}: {
  row: CaseRow;
  role: string;
  onAction: (row: CaseRow, action: ApprovalAction) => void;
}) {
  const ex = row.exchange;
  const isMgr = MGR_ROLES.has(role);
  const isOwner = role === 'OWNER';

  return (
    <div className="flex flex-wrap items-center gap-2">
      {ex?.kind === 'SAME_MODEL' && isMgr && (
        <>
          <Button variant="outline" size="sm" onClick={() => onAction(row, 'confirm')}>
            ยืนยันเปลี่ยนเครื่อง
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="text-destructive"
            onClick={() => onAction(row, 'reject')}
          >
            ปฏิเสธ
          </Button>
        </>
      )}
      {/* residual sweep — แถวที่ผูกคำขอไม่สำเร็จ (requestStatus null) ไม่มีปฏิเสธ เหลือแค่ "เปิดเคส" ·
          2026-10-06 ปิดเมนูเปลี่ยนแบบมีราคา: ไม่มีปุ่ม "อนุมัติ" ทุก role — เจ้าของ "ปฏิเสธ" เพื่อปิดคำขอค้าง */}
      {ex?.kind === 'PRICED' && ex.requestStatus != null && isMgr && (
        <>
          <span className="text-xs leading-snug text-muted-foreground">{DEVICE_SWAP_CLOSED_SHORT}</span>
          {isOwner && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive"
              onClick={() => onAction(row, 'reject')}
            >
              ปฏิเสธ
            </Button>
          )}
        </>
      )}
      <Button variant="outline" size="sm" onClick={() => onAction(row, 'open')}>
        เปิดเคส
      </Button>
    </div>
  );
}

export default function ApprovalTable({ rows, role, onAction }: ApprovalTableProps) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card px-4 py-10 text-center">
        <p className="text-sm font-semibold leading-snug">ไม่มีรายการรออนุมัติ</p>
      </div>
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-xs text-muted-foreground">
              <th className="px-3 py-2 text-left font-normal">ขอเมื่อ</th>
              <th className="px-3 py-2 text-left font-normal">เคส</th>
              <th className="px-3 py-2 text-left font-normal">ลูกค้า</th>
              <th className="px-3 py-2 text-left font-normal">เครื่องเดิม → ใหม่</th>
              <th className="px-3 py-2 text-left font-normal">ประเภท/ราคา</th>
              <th className="px-3 py-2 text-left font-normal">ใครอนุมัติได้</th>
              <th className="px-3 py-2 text-left font-normal">การกระทำ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const ex = row.exchange;
              return (
                <tr
                  key={row.id}
                  className="border-b border-border/60 last:border-0 hover:bg-accent"
                >
                  <td className="px-3 py-2.5">
                    <div>{dayOf(row.receivedAt)}</div>
                    <div className="text-xs text-muted-foreground">
                      {ex?.requestedBy?.name ?? row.receivedBy.name}
                    </div>
                  </td>
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
                    {ex?.replacementContract && (
                      <div className="text-xs leading-snug text-muted-foreground">
                        สัญญาใหม่ {ex.replacementContract.contractNumber}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 leading-snug">{ex ? deviceLine(ex) : '—'}</td>
                  <td className="px-3 py-2.5">
                    <TypePriceCell ex={ex} />
                  </td>
                  <td className="px-3 py-2.5">
                    <ApproverChip ex={ex} />
                  </td>
                  <td className="px-3 py-2.5">
                    <ActionsCell row={row} role={role} onAction={onAction} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 md:hidden">
        {rows.map((row) => {
          const ex = row.exchange;
          return (
            <div
              key={row.id}
              className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm"
            >
              <div className="flex items-center justify-between gap-2">
                <Link
                  to={`/after-sales/${row.id}`}
                  className="font-semibold text-primary hover:underline"
                >
                  {row.caseNumber}
                </Link>
                <ApproverChip ex={ex} />
              </div>
              <div className="leading-snug">
                {row.customer.name} · {row.customer.phone ?? '—'}
              </div>
              {ex?.replacementContract && (
                <div className="text-xs leading-snug text-muted-foreground">
                  สัญญาใหม่ {ex.replacementContract.contractNumber}
                </div>
              )}
              <div className="leading-snug">{ex ? deviceLine(ex) : '—'}</div>
              <TypePriceCell ex={ex} />
              <div className="text-xs leading-snug text-muted-foreground">
                ขอเมื่อ {dayOf(row.receivedAt)} · {ex?.requestedBy?.name ?? row.receivedBy.name}
              </div>
              <ActionsCell row={row} role={role} onAction={onAction} />
            </div>
          );
        })}
      </div>
    </>
  );
}
