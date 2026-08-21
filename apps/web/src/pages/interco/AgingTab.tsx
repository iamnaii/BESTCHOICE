import { CalendarClock } from 'lucide-react';
import QueryBoundary from '@/components/QueryBoundary';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { formatThaiDateShort } from '@/lib/date';
import {
  fmtMoney,
  type ShopReceivableAgingResponse,
  type ShopReceivableAgingRow,
} from './types';

/**
 * เมนู "จ่ายให้หน้าร้าน (INTER-CO)" — แท็บ "อายุลูกหนี้หน้าร้าน" (Phase 4 —
 * spec §6 ข้อ 1): รายงานอายุ 11-2107/S21-3001 แยกประเภทต่อสัญญา จาก
 * `GET /interco-settlement/shop-receivable-aging`.
 *
 * การตัดสินใจ UI (จาก review Task 1 — บันทึกเหตุผลไว้ที่นี่):
 *   - **ไม่มี date picker** — `asOf` ของ endpoint มีผลกับ "อายุ" เท่านั้น
 *     (ยอดคงเหลือเป็นปัจจุบันเสมอ ตาม jsdoc ของ IntercoAgingService) การให้
 *     ผู้ใช้เลือกวันที่จะสื่อผิดว่าเป็น "ยอด ณ วันที่ย้อนหลัง" จึงยึด default
 *     (now) แล้ว label ให้ชัด: "ยอดคงเหลือปัจจุบัน · อายุนับถึง <วันที่>"
 *   - **เกณฑ์วันค้างตรึงที่ default (30)** — ตรงกับ default ของ service ที่
 *     Task 3 (daily cron alert) ใช้ ตัวเลขบนจอกับ alert จึงเป็นเกณฑ์เดียวกัน
 *   - `legacyOneBook` = swap ยุคก่อนระบบสองสมุด (spec §11.4 — สภาพปกติ):
 *     badge กลางๆ ไม่ใช่สีแดง, ไม่นับ overdue, ยอดแยกออกจาก totals หลักไป
 *     บรรทัด "ค้าง swap ยุคเก่า" (ตรงกับสูตร totals ฝั่ง server ทุกประการ)
 *   - `bookMismatch` ที่ไม่ใช่ legacy = ผิดปกติจริง → badge destructive
 */

const EPS = 0.01;

interface AgingTabProps {
  data: ShopReceivableAgingResponse | undefined;
  /** เกณฑ์วันค้าง — ต้องเท่ากับค่าที่ server ใช้คิด totals.overdueCount (default 30) */
  thresholdDays: number;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
}

/** overdue ต่อแถว — สูตรเดียวกับ `isOverdue` ฝั่ง service (แถว legacy ไม่นับ) */
function isRowOverdue(r: ShopReceivableAgingRow, thresholdDays: number): boolean {
  if (r.legacyOneBook) return false;
  return (
    (r.intercoAgeDays !== null &&
      r.intercoAgeDays >= thresholdDays &&
      Number(r.intercoNet) > EPS) ||
    (r.shopCollectAgeDays !== null &&
      r.shopCollectAgeDays >= thresholdDays &&
      Number(r.shopCollect) > EPS)
  );
}

/** อายุที่แสดง = max ของสองกลุ่ม (ตรงกับ effectiveAge ที่ service ใช้เรียงแถว) */
function displayAgeDays(r: ShopReceivableAgingRow): number | null {
  if (r.intercoAgeDays === null && r.shopCollectAgeDays === null) return null;
  return Math.max(r.intercoAgeDays ?? -1, r.shopCollectAgeDays ?? -1);
}

export function AgingTab({
  data,
  thresholdDays,
  isLoading,
  isError,
  error,
  onRetry,
}: AgingTabProps) {
  const rows = data?.rows ?? [];
  const totals = data?.totals;

  return (
    <div className="space-y-4 pt-4">
      <QueryBoundary
        isLoading={isLoading}
        isError={isError}
        error={error}
        onRetry={onRetry}
        errorTitle="ไม่สามารถโหลดรายงานอายุลูกหนี้หน้าร้านได้"
      >
        <div className="space-y-4">
          {totals && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <SummaryTile
                label="ลูกหนี้ระหว่างกิจการสุทธิ (11-2107)"
                value={`฿${fmtMoney(totals.intercoNet)}`}
              />
              <SummaryTile
                label="หน้าร้านรับแทน (SHOP_COLLECT)"
                value={`฿${fmtMoney(totals.shopCollect)}`}
              />
              <SummaryTile
                label={`ค้างเกินเกณฑ์ (${thresholdDays} วัน)`}
                value={`${totals.overdueCount} สัญญา`}
                tone={totals.overdueCount > 0 ? 'warning' : 'default'}
              />
              <SummaryTile
                label="ค้าง swap ยุคเก่า (สมุดเดียว)"
                value={`฿${fmtMoney(totals.legacyOneBookNet)}`}
                hint="ไม่รวมในยอดรวมหลัก — ล้างผ่านช่องทางรับโอนจากหน้าร้าน"
              />
            </div>
          )}

          <Card>
            <CardHeader>
              <h2 className="text-lg font-semibold flex items-center gap-2 leading-snug">
                <CalendarClock className="h-5 w-5 text-primary" />
                อายุลูกหนี้หน้าร้าน ({rows.length} สัญญา)
              </h2>
              <p className="text-xs text-muted-foreground leading-snug">
                ยอดคงเหลือปัจจุบัน · อายุนับถึง{' '}
                {data ? formatThaiDateShort(data.asOf) : '-'} — วันที่ใช้คำนวณอายุเท่านั้น
                ยอดทุกคอลัมน์เป็นยอดคงเหลือ ณ ปัจจุบันเสมอ
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
                        เครดิตเปลี่ยนเครื่อง
                      </th>
                      <th className="text-right p-3 font-medium text-muted-foreground">
                        เรียกคืนจากยกเลิก
                      </th>
                      <th className="text-right p-3 font-medium text-muted-foreground">
                        หักไปแล้ว
                      </th>
                      <th className="text-right p-3 font-medium text-muted-foreground">
                        คงเหลือสุทธิ
                      </th>
                      <th className="text-right p-3 font-medium text-muted-foreground">
                        หน้าร้านรับแทน
                      </th>
                      <th className="text-right p-3 font-medium text-muted-foreground">
                        อายุ (วัน)
                      </th>
                      <th className="text-right p-3 font-medium text-muted-foreground">สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={8}
                          className="p-8 text-center text-muted-foreground leading-snug"
                        >
                          ไม่มีลูกหนี้หน้าร้านค้างอยู่
                        </td>
                      </tr>
                    ) : (
                      rows.map((r) => {
                        const overdue = isRowOverdue(r, thresholdDays);
                        const age = displayAgeDays(r);
                        return (
                          <tr key={r.contractId} className="border-t border-border">
                            <td className="p-3">
                              <div className="font-medium leading-snug">{r.contractNumber}</div>
                              <div className="text-xs text-muted-foreground leading-snug">
                                {r.customerName}
                              </div>
                            </td>
                            <td className="p-3 text-right tabular-nums">
                              {fmtMoney(r.swapCreditGross)}
                            </td>
                            <td className="p-3 text-right tabular-nums">
                              {fmtMoney(r.payoutRecallGross)}
                            </td>
                            <td className="p-3 text-right tabular-nums">
                              {Number(r.settledDeduction) > 0 ? (
                                <span className="text-muted-foreground">
                                  −{fmtMoney(r.settledDeduction)}
                                </span>
                              ) : (
                                fmtMoney(r.settledDeduction)
                              )}
                            </td>
                            <td className="p-3 text-right tabular-nums font-medium">
                              {fmtMoney(r.intercoNet)}
                            </td>
                            <td className="p-3 text-right tabular-nums">
                              {fmtMoney(r.shopCollect)}
                            </td>
                            <td
                              className={`p-3 text-right tabular-nums ${
                                overdue ? 'text-warning font-medium' : ''
                              }`}
                              title={[
                                r.intercoOldestPostedAt
                                  ? `ตั้งหนี้ interco เก่าสุด ${formatThaiDateShort(r.intercoOldestPostedAt)}`
                                  : null,
                                r.shopCollectOldestPostedAt
                                  ? `หน้าร้านรับแทนเก่าสุด ${formatThaiDateShort(r.shopCollectOldestPostedAt)}`
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            >
                              {age ?? '-'}
                            </td>
                            <td className="p-3 text-right">
                              {r.legacyOneBook ? (
                                <Badge
                                  variant="secondary"
                                  appearance="light"
                                  size="sm"
                                  title="สัญญาเปลี่ยนเครื่องยุคก่อนระบบสองสมุด (สมุด SHOP ไม่มียอดตั้งต้น — สภาพปกติตาม spec) ล้างยอดผ่านช่องทางรับโอนจากหน้าร้าน ไม่นับรวมในยอดรวมหลัก"
                                >
                                  ยุคก่อนระบบสองสมุด
                                </Badge>
                              ) : (
                                <div className="flex items-center justify-end gap-1 flex-wrap">
                                  {r.bookMismatch && (
                                    <Badge
                                      variant="destructive"
                                      appearance="light"
                                      size="sm"
                                      title={`ยอดสองสมุดไม่เท่ากัน — FINANCE ฿${fmtMoney(r.intercoNet)} ≠ SHOP ฿${fmtMoney(r.shopMirrorNet)} ต้องตรวจสอบ GL`}
                                    >
                                      สองสมุดไม่ตรง
                                    </Badge>
                                  )}
                                  {overdue && (
                                    <Badge variant="warning" appearance="light" size="sm">
                                      ค้างเกิน {thresholdDays} วัน
                                    </Badge>
                                  )}
                                  {!r.bookMismatch && !overdue && (
                                    <span className="text-muted-foreground">-</span>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
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

function SummaryTile({
  label,
  value,
  hint,
  tone = 'default',
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'warning';
}) {
  return (
    <Card>
      <CardContent className="pt-4 pb-4">
        <p className="text-xs text-muted-foreground leading-snug">{label}</p>
        <p
          className={`text-xl font-bold mt-1 tabular-nums leading-snug ${
            tone === 'warning' ? 'text-warning' : 'text-foreground'
          }`}
        >
          {value}
        </p>
        {hint && <p className="text-[11px] text-muted-foreground leading-snug mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}
