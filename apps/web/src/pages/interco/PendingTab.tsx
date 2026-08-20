import { AlertTriangle, ClipboardList, Undo2 } from 'lucide-react';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { formatThaiDateShort } from '@/lib/date';
import {
  fmtMoney,
  type PendingContract,
  type RecallCandidate,
  type ReconcileTotals,
} from './types';

/**
 * เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — แท็บ "รอจ่าย" (spec §8 แท็บ 1).
 *
 * Reconcile strip = sanity check ระดับบัญชี (spec §4): ยอดคิวรอจ่ายรวม ต้อง
 * ใกล้เคียง GL 21-1101+21-1102 ทั้งบัญชี — drift ที่ไม่ใช่ 0 แปลว่ามี JE
 * แปลกปลอม/เส้นเก่าที่ไม่มี metadata.contractId (pre-flight §10 ข้อ 1).
 */

const DRIFT_TOLERANCE = 0.01;

/** ยอดหักของแถว — หักได้เฉพาะ eligible (mixed-era swap = 0, ล้างผ่านรับโอนหน้าร้านแทน) */
function rowDeduction(p: PendingContract): number {
  return p.swapCreditEligible ? Number(p.swapCreditGl) : 0;
}

/** สองสมุดไม่ตรงกัน ±0.01 — เลือกเข้ารอบไม่ได้ (backend ปฏิเสธที่ createBatch อยู่แล้ว) */
function recallMismatch(r: RecallCandidate): boolean {
  return Math.abs(Number(r.recallGl) - Number(r.shopRecallGl)) > DRIFT_TOLERANCE;
}

interface PendingTabProps {
  pending: PendingContract[];
  recalls: RecallCandidate[];
  reconcile: ReconcileTotals | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  selectedIds: Set<string>;
  onToggle: (contractId: string) => void;
  onToggleAll: () => void;
  selectedRecallIds: Set<string>;
  onToggleRecall: (contractId: string) => void;
  onCreateClick: () => void;
}

export function PendingTab({
  pending,
  recalls,
  reconcile,
  isLoading,
  isError,
  error,
  onRetry,
  selectedIds,
  onToggle,
  onToggleAll,
  selectedRecallIds,
  onToggleRecall,
  onCreateClick,
}: PendingTabProps) {
  const drift = Number(reconcile?.drift ?? 0);
  const hasDrift = Math.abs(drift) > DRIFT_TOLERANCE;
  const allSelected = pending.length > 0 && selectedIds.size === pending.length;

  const selectedContracts = pending.filter((p) => selectedIds.has(p.contractId));
  const selectedTotal = selectedContracts.reduce(
    (sum, p) => sum + Number(p.financedGl) + Number(p.commissionGl),
    0,
  );
  const selectedRecallTotal = recalls
    .filter((r) => selectedRecallIds.has(r.contractId))
    .reduce((sum, r) => sum + Number(r.recallGl), 0);
  const selectedDeduction =
    selectedContracts.reduce((sum, p) => sum + rowDeduction(p), 0) + selectedRecallTotal;

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
            <strong>ยอดคิวรอจ่ายไม่ตรงกับ GL ทั้งบัญชี</strong> — ส่วนต่าง ฿
            {fmtMoney(Math.abs(drift))}. อาจมีรายการเดินบัญชีที่ไม่ผูกเลขที่สัญญา (JE
            เส้นเก่าก่อนเปิดใช้รอบจ่าย) — ตรวจสอบก่อนเริ่ม บันทึกรอบย้อนหลัง
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
        <div className="space-y-4">
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
                      <th className="text-right p-3 font-medium text-muted-foreground">
                        หักเครดิตเปลี่ยนเครื่อง
                      </th>
                      <th className="text-right p-3 font-medium text-muted-foreground">โอนสุทธิ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pending.length === 0 ? (
                      <tr>
                        <td
                          colSpan={7}
                          className="p-8 text-center text-muted-foreground leading-snug"
                        >
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
                          <td className="p-3 text-right tabular-nums">
                            {fmtMoney(p.commissionGl)}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {p.swapCreditEligible ? (
                              <span className="text-warning">−{fmtMoney(p.swapCreditGl)}</span>
                            ) : Number(p.swapCreditGl) > 0 ? (
                              <Badge
                                variant="secondary"
                                appearance="light"
                                size="sm"
                                title="สัญญาเปลี่ยนเครื่องยุคก่อน Phase 1 — เครดิต 11-2107 สองสมุดไม่เท่ากัน จึงหักกลบในรอบจ่ายไม่ได้ ให้ล้างผ่านช่องทางรับโอนจากหน้าร้านแทน"
                              >
                                ล้างผ่านรับโอนหน้าร้าน
                              </Badge>
                            ) : (
                              <span className="text-muted-foreground">-</span>
                            )}
                          </td>
                          <td className="p-3 text-right tabular-nums font-medium">
                            {fmtMoney(
                              Number(p.financedGl) + Number(p.commissionGl) - rowDeduction(p),
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {recalls.length > 0 && (
            <Card>
              <CardHeader>
                <h2 className="text-lg font-semibold flex items-center gap-2 leading-snug">
                  <Undo2 className="h-5 w-5 text-warning" />
                  รายการเรียกคืน (ยกเลิกหลังตัดจ่าย) ({recalls.length} รายการ)
                </h2>
                <p className="text-xs text-muted-foreground leading-snug">
                  สัญญาเปลี่ยนเครื่องที่ยกเลิกหลังรอบจ่ายตัดไปแล้ว —
                  เลือกเพื่อหักเงินคืนจากรอบจ่ายถัดไป (ต้องมีสัญญาค้างจ่ายในรอบอย่างน้อย 1 สัญญา)
                </p>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm leading-snug">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="w-10 p-3" aria-label="เลือกรายการเรียกคืน" />
                        <th className="text-left p-3 font-medium text-muted-foreground">
                          เลขสัญญา / ลูกค้า
                        </th>
                        <th className="text-right p-3 font-medium text-muted-foreground">
                          ยอดเรียกคืน (11-2107)
                        </th>
                        <th className="text-right p-3 font-medium text-muted-foreground">
                          ฝั่ง SHOP (S21-3001)
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {recalls.map((r) => {
                        const mismatch = recallMismatch(r);
                        return (
                          <tr
                            key={r.contractId}
                            className={`border-t border-border ${
                              mismatch ? 'opacity-70' : 'hover:bg-accent/30 cursor-pointer'
                            }`}
                            onClick={() => !mismatch && onToggleRecall(r.contractId)}
                          >
                            <td className="p-3" onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selectedRecallIds.has(r.contractId)}
                                onCheckedChange={() => onToggleRecall(r.contractId)}
                                disabled={mismatch}
                                aria-label={`เลือกเรียกคืนสัญญา ${r.contractNumber}`}
                              />
                            </td>
                            <td className="p-3">
                              <div className="font-medium leading-snug flex items-center gap-2 flex-wrap">
                                {r.contractNumber}
                                {mismatch && (
                                  <Badge
                                    variant="warning"
                                    appearance="light"
                                    size="sm"
                                    title="ยอด 11-2107 กับ S21-3001 ไม่เท่ากัน — GL ผิดปกติ ตรวจสอบก่อนจึงจะหักเข้ารอบได้"
                                  >
                                    ยอดสองสมุดไม่ตรง
                                  </Badge>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground leading-snug">
                                {r.customerName}
                              </div>
                            </td>
                            <td className="p-3 text-right tabular-nums text-warning">
                              −{fmtMoney(r.recallGl)}
                            </td>
                            <td className="p-3 text-right tabular-nums">
                              {fmtMoney(r.shopRecallGl)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </QueryBoundary>

      {(selectedIds.size > 0 || selectedRecallIds.size > 0) && (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-4 shadow-lg flex-wrap">
          <div className="text-sm leading-snug">
            เลือกแล้ว <strong>{selectedIds.size}</strong> สัญญา
            {selectedRecallIds.size > 0 && (
              <>
                {' '}
                + เรียกคืน <strong>{selectedRecallIds.size}</strong> รายการ
              </>
            )}{' '}
            • รวม <strong className="tabular-nums">฿{fmtMoney(selectedTotal)}</strong>
            {selectedDeduction > 0 && (
              <>
                {' '}
                • หัก{' '}
                <strong className="tabular-nums text-warning">
                  ฿{fmtMoney(selectedDeduction)}
                </strong>{' '}
                • โอนสุทธิ{' '}
                <strong className="tabular-nums">
                  ฿{fmtMoney(selectedTotal - selectedDeduction)}
                </strong>
              </>
            )}
            {selectedIds.size === 0 && (
              <span className="block text-xs text-muted-foreground">
                ต้องเลือกสัญญาค้างจ่ายอย่างน้อย 1 สัญญาจึงจะสร้างรอบได้
              </span>
            )}
          </div>
          <Button onClick={onCreateClick} disabled={selectedIds.size === 0}>
            สร้างรอบจ่าย
          </Button>
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
