import { AlertTriangle, RefreshCw, Scale } from 'lucide-react';
import QueryBoundary from '@/components/QueryBoundary';
import { useAuth } from '@/contexts/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { formatThaiDateShort } from '@/lib/date';
import {
  INTERCO_APPROVER_ROLES,
  RECONCILE_KIND_LABEL,
  fmtMoney,
  type ReconcileFindingsResponse,
  type ReconcileRunResponse,
} from './types';

/**
 * เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — แท็บ **"กระทบยอด"** (Phase 5 Task 5 ข้อ 1+4).
 *
 * ทำไมต้องเป็นแท็บใหม่ ไม่ยัดรวมกับ "อายุลูกหนี้หน้าร้าน":
 *   - แท็บอายุคือ **หนี้ที่ต้องไปตาม** — กรองด้วย `isReportableAgingRow`
 *     (ยอดบวก/สองสมุดไม่ตรง) และ `totals` บนหัวแท็บเป็นผลรวมของแถวที่แสดง.
 *     เอาแถวยอดติดลบไปปนจะไป **หักล้างหนี้ค้างจริงของสัญญาอื่น** บนหัวแท็บ —
 *     เป็นบั๊กคลาสเดียวกับ carry ก ที่ Phase 4 เพิ่งปิดไป
 *   - ที่นี่คือ "รายการที่ต้องสอบ": คู่เจ้าหนี้/ลูกหนี้รอบจ่ายไม่ตรงกัน +
 *     ยอด typed ติดลบ (ล้างเกิน) — สองมุมที่ reconcile cron รายงานทุกเดือนแต่
 *     **ไม่เคยมีที่ให้ดู** (ใบ Todo ถึงต้องเขียนว่า "ให้ใช้ข้อมูลในใบนี้")
 *
 * doctrine: หน้าจอนี้ **อ่านอย่างเดียว ไม่มีปุ่มแก้ GL** — การตั้ง JE ปรับปรุง
 * ต้องให้ผู้มีอำนาจ/ผู้สอบบัญชีตัดสิน (คลาสเดียวกับ opening-balance gap ที่รอ
 * CPA อยู่). ปุ่มเดียวที่มีคือ "สั่งรันกระทบยอด" ซึ่งเรียก `tick()` ตัวเดียวกับ
 * cron รายเดือน (dedup Todo ชุดเดิม) — ไม่แตะบัญชีแม้แต่บรรทัดเดียว.
 */

interface ReconcileTabProps {
  data: ReconcileFindingsResponse | undefined;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  /** สั่งรันกระทบยอด (page ถือ mutation — pattern เดียวกับแท็บอื่นที่เป็น presentational) */
  onRun: () => void;
  isRunning: boolean;
  /** ผลรันล่าสุดในหน้าจอนี้ (null = ยังไม่ได้กด) */
  lastRun: ReconcileRunResponse | null;
}

export function ReconcileTab({
  data,
  isLoading,
  isError,
  error,
  onRetry,
  onRun,
  isRunning,
  lastRun,
}: ReconcileTabProps) {
  const { user } = useAuth();
  // ปุ่มสั่งรันเขียนใบงาน + ยิง Sentry ให้ทั้งองค์กรเห็น → gate ที่ role ระดับ
  // checker (OWNER/FINANCE_MANAGER) เหมือน endpoint (ACC เห็นรายการได้ แต่สั่งรันไม่ได้)
  const canRun = !!user && INTERCO_APPROVER_ROLES.includes(user.role);

  const pairs = data?.pairMismatches ?? [];
  const negatives = data?.negativeRows ?? [];

  return (
    <div className="space-y-4 pt-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-lg font-semibold flex items-center gap-2 leading-snug">
                <Scale className="h-5 w-5 text-primary" />
                กระทบยอดระหว่างกิจการ
              </h2>
              <p className="text-xs text-muted-foreground leading-snug mt-1">
                รายการที่ตรวจพบว่าไม่ตรงกันแต่ไม่ใช่ "หนี้ค้าง" จึงไม่แสดงในแท็บอายุลูกหนี้ ·
                ยอดคงเหลือปัจจุบัน · ข้อมูล ณ{' '}
                {data ? formatThaiDateShort(data.asOf) : '-'}
              </p>
            </div>
            {canRun && (
              <Button variant="outline" size="sm" onClick={onRun} disabled={isRunning}>
                <RefreshCw className={`h-4 w-4 mr-1 ${isRunning ? 'animate-spin' : ''}`} />
                {isRunning ? 'กำลังกระทบยอด...' : 'สั่งรันกระทบยอดตอนนี้'}
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-sm leading-snug">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
            <div className="text-muted-foreground">
              ระบบ<strong>ไม่ตั้ง JE ปรับปรุงให้อัตโนมัติ</strong> —
              ต้องให้ผู้มีอำนาจ/ผู้สอบบัญชีตัดสินก่อนแก้ทุกกรณี ·
              การกระทบยอดรายเดือนรันเองอัตโนมัติวันที่ 1 เวลา 08:00 น. และสร้างใบงานหนึ่งใบต่อเดือน
            </div>
          </div>

          {lastRun && <RunSummary result={lastRun} />}
        </CardContent>
      </Card>

      <QueryBoundary
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={onRetry}
        errorTitle="ไม่สามารถโหลดรายการกระทบยอดได้"
      >
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <h3 className="font-semibold leading-snug">
                เจ้าหนี้/ลูกหนี้รอบจ่ายไม่ตรงกัน ({pairs.length} สัญญา)
              </h3>
              <p className="text-xs text-muted-foreground leading-snug">
                เจ้าหนี้ FINANCE (21-1101+21-1102) ต้องเท่ากับลูกหนี้ฝั่ง SHOP (S11-3001+S11-3002)
                เสมอ — รอบจ่ายล้างสองขาพร้อมกันด้วยยอดเดียวกัน ต่างกัน =
                มีการแก้สมุดเดียว (สัญญาก่อน 23 มิ.ย. 2026 ที่สมุด SHOP ยังไม่มีลูกหนี้ ไม่นับ)
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm leading-snug">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium text-muted-foreground">
                        สัญญา / ลูกค้า
                      </th>
                      <th className="text-right p-3 font-medium text-muted-foreground">
                        เจ้าหนี้ FINANCE
                      </th>
                      <th className="text-right p-3 font-medium text-muted-foreground">
                        ลูกหนี้ SHOP
                      </th>
                      <th className="text-right p-3 font-medium text-muted-foreground">
                        ต่าง: ยอดจัด
                      </th>
                      <th className="text-right p-3 font-medium text-muted-foreground">
                        ต่าง: ค่าคอม
                      </th>
                      <th className="text-right p-3 font-medium text-muted-foreground">รูปแบบ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pairs.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="p-8 text-center text-muted-foreground leading-snug"
                        >
                          เจ้าหนี้กับลูกหนี้รอบจ่ายตรงกันทุกสัญญา
                        </td>
                      </tr>
                    ) : (
                      pairs.map((p) => (
                        <tr key={p.contractId} className="border-t border-border">
                          <td className="p-3">
                            <div className="font-medium leading-snug">{p.contractNumber}</div>
                            <div className="text-xs text-muted-foreground leading-snug">
                              {p.customerName}
                            </div>
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {fmtMoney(Number(p.financedGl) + Number(p.commissionGl))}
                            <div className="text-xs text-muted-foreground">
                              {fmtMoney(p.financedGl)} + คอม {fmtMoney(p.commissionGl)}
                            </div>
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {fmtMoney(Number(p.shopFinancedGl) + Number(p.shopCommissionGl))}
                            <div className="text-xs text-muted-foreground">
                              {fmtMoney(p.shopFinancedGl)} + คอม {fmtMoney(p.shopCommissionGl)}
                            </div>
                          </td>
                          <td className="p-3 text-right tabular-nums font-medium">
                            {fmtMoney(p.financedDiff)}
                          </td>
                          <td className="p-3 text-right tabular-nums font-medium">
                            {fmtMoney(p.commissionDiff)}
                          </td>
                          <td className="p-3 text-right">
                            {p.commissionOnly ? (
                              <Badge
                                variant="secondary"
                                appearance="light"
                                size="sm"
                                title="สัญญาที่ไม่ได้ระบุค่าคอม: ตอนเปิดสัญญาระบบตั้งค่าคอม 10% อัตโนมัติฝั่ง FINANCE แต่สมุด SHOP ตั้ง 0 — เป็นส่วนต่างจริงในบัญชี รอเจ้าของ/ผู้สอบบัญชีตัดสินวิธีแก้"
                              >
                                ต่างเฉพาะค่าคอม
                              </Badge>
                            ) : (
                              <Badge variant="destructive" appearance="light" size="sm">
                                ต้องตรวจสอบ
                              </Badge>
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

          <Card>
            <CardHeader>
              <h3 className="font-semibold leading-snug">
                ยอดติดลบ — ล้างเกิน ({negatives.length} สัญญา)
              </h3>
              <p className="text-xs text-muted-foreground leading-snug">
                ลูกหนี้ติดลบ = ถูกหักกลบในรอบจ่าย/รับเงินคืนเกินยอดที่ตั้งไว้ ·
                แถวเหล่านี้ไม่ขึ้นในแท็บอายุลูกหนี้โดยตั้งใจ (ยอดติดลบไม่ใช่หนี้ และจะไปหักล้างยอดรวมของสัญญาอื่น)
              </p>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm leading-snug">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-3 font-medium text-muted-foreground">
                        สัญญา / ลูกค้า
                      </th>
                      <th className="text-left p-3 font-medium text-muted-foreground">
                        ช่องที่ติดลบ
                      </th>
                      <th className="text-right p-3 font-medium text-muted-foreground">
                        คงเหลือสุทธิ (11-2107)
                      </th>
                      <th className="text-right p-3 font-medium text-muted-foreground">
                        กระจกฝั่ง SHOP
                      </th>
                      <th className="text-right p-3 font-medium text-muted-foreground">
                        หักไปแล้ว
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {negatives.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="p-8 text-center text-muted-foreground leading-snug"
                        >
                          ไม่มียอดติดลบ
                        </td>
                      </tr>
                    ) : (
                      negatives.map((r) => (
                        <tr key={r.contractId} className="border-t border-border">
                          <td className="p-3">
                            <div className="font-medium leading-snug">{r.contractNumber}</div>
                            <div className="text-xs text-muted-foreground leading-snug">
                              {r.customerName}
                            </div>
                          </td>
                          <td className="p-3">
                            <div className="flex flex-col gap-1">
                              {r.negativeFields.map((f) => (
                                <span key={f.field} className="text-destructive leading-snug">
                                  {f.label}: {fmtMoney(f.value)}
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="p-3 text-right tabular-nums">{fmtMoney(r.intercoNet)}</td>
                          <td className="p-3 text-right tabular-nums">
                            {fmtMoney(r.shopMirrorNet)}
                          </td>
                          <td className="p-3 text-right tabular-nums">
                            {fmtMoney(r.settledDeduction)}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </QueryBoundary>
    </div>
  );
}

/** สรุปผลการสั่งรันครั้งล่าสุดในหน้าจอนี้ (ไม่ใช่สถานะถาวร — refresh แล้วหาย) */
function RunSummary({ result }: { result: ReconcileRunResponse }) {
  if (!result.enabled) {
    return (
      <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning leading-snug">
        การกระทบยอดถูกปิดไว้ (SystemConfig <code>interco_reconcile_enabled</code>) — ยังไม่ได้ตรวจอะไรเลย
        ให้ผู้ดูแลระบบเปิดค่านี้ในฐานข้อมูลก่อน (คีย์นี้ยังไม่มีหน้าจอตั้งค่า)
      </div>
    );
  }
  if (result.total === 0) {
    return (
      <div className="rounded-md border border-success/40 bg-success/10 p-3 text-sm text-success leading-snug">
        กระทบยอดแล้ว — ตรงทุกรายการ ไม่มีสิ่งผิดปกติ
      </div>
    );
  }
  return (
    <div className="rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning leading-snug">
      <div>
        กระทบยอดแล้ว — พบ {result.total} รายการไม่ตรง:{' '}
        {Object.entries(result.counts)
          .map(
            ([kind, n]) =>
              `${RECONCILE_KIND_LABEL[kind as keyof typeof RECONCILE_KIND_LABEL] ?? kind} ${n}`,
          )
          .join(' · ')}
      </div>
      <div className="text-xs mt-1">
        {result.todoCreated
          ? 'สร้างใบงาน (Todo) ของเดือนนี้แล้ว — ดูรายละเอียดครบทุกรายการที่เมนูใบงาน'
          : 'เดือนนี้มีใบงานค้างอยู่แล้ว จึงไม่สร้างซ้ำ — เปิดใบเดิมที่เมนูใบงาน'}
        {' · '}
        รายการระดับบัญชี (ยอดบัญชีอธิบายไม่ได้) ไม่มีเลขสัญญา จึงดูได้ในใบงาน/Sentry เท่านั้น
      </div>
    </div>
  );
}
