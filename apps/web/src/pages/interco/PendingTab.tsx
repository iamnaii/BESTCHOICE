import { AlertTriangle, ClipboardList } from 'lucide-react';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { formatThaiDateShort } from '@/lib/date';
import { fmtMoney, type PendingContract, type ReconcileTotals } from './types';

/**
 * เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — แท็บ "รอจ่าย" (spec §8 แท็บ 1).
 *
 * Reconcile strip = sanity check ระดับบัญชี (spec §4): ยอดคิวรอจ่ายรวม ต้อง
 * ใกล้เคียง GL 21-1101+21-1102 ทั้งบัญชี — drift ที่ไม่ใช่ 0 แปลว่ามี JE
 * แปลกปลอม/เส้นเก่าที่ไม่มี metadata.contractId (pre-flight §10 ข้อ 1).
 */

const DRIFT_TOLERANCE = 0.01;

interface PendingTabProps {
  pending: PendingContract[];
  reconcile: ReconcileTotals | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  selectedIds: Set<string>;
  onToggle: (contractId: string) => void;
  onToggleAll: () => void;
  onCreateClick: () => void;
}

export function PendingTab({
  pending,
  reconcile,
  isLoading,
  isError,
  error,
  onRetry,
  selectedIds,
  onToggle,
  onToggleAll,
  onCreateClick,
}: PendingTabProps) {
  const drift = Number(reconcile?.drift ?? 0);
  const hasDrift = Math.abs(drift) > DRIFT_TOLERANCE;
  const allSelected = pending.length > 0 && selectedIds.size === pending.length;

  const selectedTotal = pending
    .filter((p) => selectedIds.has(p.contractId))
    .reduce((sum, p) => sum + Number(p.financedGl) + Number(p.commissionGl), 0);

  return (
    <div className="space-y-4 pt-4">
      {reconcile && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatTile label="ยอดคิวรวม" value={reconcile.pendingTotal} />
          <StatTile label="GL FINANCE (21-1101+21-1102)" value={reconcile.glFinanceTotal} />
          <StatTile label="GL SHOP (S11-3001+S11-3002)" value={reconcile.glShopTotal} />
          <StatTile
            label="ส่วนต่าง"
            value={reconcile.drift}
            tone={hasDrift ? 'warning' : 'success'}
          />
        </div>
      )}

      {hasDrift && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning leading-snug">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            <strong>ยอดคิวรอจ่ายไม่ตรงกับ GL ทั้งบัญชี</strong> — ส่วนต่าง ฿{fmtMoney(Math.abs(drift))}.
            อาจมีรายการเดินบัญชีที่ไม่ผูกเลขที่สัญญา (JE เส้นเก่าก่อนเปิดใช้รอบจ่าย) — ตรวจสอบก่อนเริ่ม
            บันทึกรอบย้อนหลัง
          </div>
        </div>
      )}

      <QueryBoundary
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={onRetry}
        errorTitle="ไม่สามารถโหลดคิวรอจ่ายได้"
      >
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-semibold flex items-center gap-2 leading-snug">
                <ClipboardList className="h-5 w-5 text-primary" />
                สัญญาค้างจ่าย ({pending.length} รายการ)
              </h2>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm leading-snug">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="w-10 p-3">
                      <Checkbox
                        checked={allSelected}
                        onCheckedChange={onToggleAll}
                        aria-label="เลือกทั้งหมด"
                        disabled={pending.length === 0}
                      />
                    </th>
                    <th className="text-left p-3 font-medium text-muted-foreground">
                      เลขสัญญา / ลูกค้า
                    </th>
                    <th className="text-center p-3 font-medium text-muted-foreground">
                      วันที่ activate
                    </th>
                    <th className="text-right p-3 font-medium text-muted-foreground">ยอดจัด</th>
                    <th className="text-right p-3 font-medium text-muted-foreground">ค่าคอม</th>
                  </tr>
                </thead>
                <tbody>
                  {pending.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-8 text-center text-muted-foreground leading-snug">
                        ไม่มีสัญญาค้างจ่าย
                      </td>
                    </tr>
                  ) : (
                    pending.map((p) => (
                      <tr
                        key={p.contractId}
                        className="border-t border-border hover:bg-accent/30 cursor-pointer"
                        onClick={() => onToggle(p.contractId)}
                      >
                        <td className="p-3" onClick={(e) => e.stopPropagation()}>
                          <Checkbox
                            checked={selectedIds.has(p.contractId)}
                            onCheckedChange={() => onToggle(p.contractId)}
                            aria-label={`เลือกสัญญา ${p.contractNumber}`}
                          />
                        </td>
                        <td className="p-3">
                          <div className="font-medium leading-snug flex items-center gap-2 flex-wrap">
                            {p.contractNumber}
                            {p.legacyNoShop && (
                              <Badge variant="warning" appearance="light" size="sm">
                                LEGACY — SHOP ไม่มียอดตั้งต้น
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground leading-snug">
                            {p.customerName}
                          </div>
                        </td>
                        <td className="p-3 text-center text-xs text-muted-foreground">
                          {p.activatedAt ? formatThaiDateShort(p.activatedAt) : '-'}
                        </td>
                        <td className="p-3 text-right tabular-nums">{fmtMoney(p.financedGl)}</td>
                        <td className="p-3 text-right tabular-nums">{fmtMoney(p.commissionGl)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </QueryBoundary>

      {selectedIds.size > 0 && (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-lg flex-wrap">
          <div className="text-sm leading-snug">
            เลือกแล้ว <strong>{selectedIds.size}</strong> สัญญา • รวม{' '}
            <strong className="tabular-nums">฿{fmtMoney(selectedTotal)}</strong>
          </div>
          <Button onClick={onCreateClick}>สร้างรอบจ่าย</Button>
        </div>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'warning' | 'success';
}) {
  const toneClass =
    tone === 'warning' ? 'text-warning' : tone === 'success' ? 'text-success' : 'text-foreground';
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <p className="text-xs text-muted-foreground leading-snug">{label}</p>
        <p className={`text-xl font-bold mt-1 tabular-nums leading-snug ${toneClass}`}>
          ฿{fmtMoney(value)}
        </p>
      </CardContent>
    </Card>
  );
}
