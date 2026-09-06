import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { Coins, History, Package, Paperclip, PencilLine, Phone, Printer, Truck, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getStatusBadgeProps, poStatusMap, poPaymentStatusMap } from '@/lib/status-badges';
import { formatDateShort, formatDateMedium, formatDateTime, formatNumber, formatNumberDecimal } from '@/utils/formatters';
import type { PurchaseOrder, PODetail, POItem } from '../types';
import { paymentMethodLabels } from '../constants';
import { canCancel } from '../po-list.util';
import {
  accessoryFor,
  accessoryTitle,
  canReceive,
  dueStatus,
  isAccessory,
  itemCondition,
  paymentProgress,
  poHistory,
  receivingProgress,
  type HistoryTone,
} from '../po-detail.util';

export interface PODetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPO: PurchaseOrder | null;
  poDetail: PODetail | null;
  openReceiveModal: (po: PurchaseOrder) => void;
  openPaymentModal: (po: PurchaseOrder) => void;
  /** Footer "ยกเลิก PO" — shown only when given and the PO is still cancellable. */
  onCancel?: (po: PurchaseOrder) => void;
}

/** Whole baht stay whole ("10,700"); satang show two places ("47,165.60"). */
const money = (v: string | number) => {
  const n = Number(v) || 0;
  return Number.isInteger(n) ? formatNumber(n) : formatNumberDecimal(n, 2);
};

const labelCls = 'text-[11px] font-medium uppercase tracking-wider text-muted-foreground';
const cardCls = 'rounded-xl border border-border/50 bg-card p-5 shadow-sm';
const thCls = 'px-2.5 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground leading-snug';
const tdCls = 'px-2.5 py-3 align-middle';

const TONE_DOT: Record<HistoryTone, string> = {
  info: 'bg-info ring-info/15',
  success: 'bg-success ring-success/15',
  muted: 'bg-muted-foreground ring-muted-foreground/15',
  destructive: 'bg-destructive ring-destructive/15',
};

function CardHeader({ icon, tone, title, sub }: { icon: React.ReactNode; tone: string; title: string; sub?: string }) {
  return (
    <div className="mb-4 flex items-center gap-2.5">
      <div className={cn('flex size-8 items-center justify-center rounded-lg', tone)}>{icon}</div>
      <div>
        <h3 className="text-sm font-semibold leading-snug text-foreground">{title}</h3>
        {sub && <p className="text-xs leading-snug text-muted-foreground">{sub}</p>}
      </div>
    </div>
  );
}

function ProgressBar({ pct, tone }: { pct: number; tone: 'success' | 'warning' }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary" aria-hidden>
      <div className={cn('h-1.5 rounded-full', tone === 'success' ? 'bg-success' : 'bg-warning')} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function PODetailModal({ isOpen, onClose, selectedPO, poDetail, openReceiveModal, openPaymentModal, onCancel }: PODetailModalProps) {
  const navigate = useNavigate();
  const overlayRef = useRef<HTMLDivElement>(null);

  // Esc closes this modal — but only while it is the top-most dialog. The payment / receive
  // modals and the Radix confirm dialog all render after it in the DOM (siblings in index.tsx,
  // portals at the end of body), so a later [role=dialog] means something is open on top.
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== overlayRef.current) return;
      e.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;
  const po = selectedPO;

  // Per-PO-item QC tally from each item's receiving products (findOne includes
  // items.receivingItems.product.status — see po-query.service.ts:55-62).
  const qcByItem = new Map<string, { qcPending: number; inStock: number }>();
  for (const item of po?.items ?? []) {
    const acc = { qcPending: 0, inStock: 0 };
    for (const ri of item.receivingItems ?? []) {
      if (ri.status !== 'PASS' || !ri.product) continue;
      if (ri.product.status === 'QC_PENDING' || ri.product.status === 'PHOTO_PENDING') acc.qcPending += 1;
      else if (ri.product.status === 'IN_STOCK') acc.inStock += 1;
    }
    if (acc.qcPending > 0 || acc.inStock > 0) qcByItem.set(item.id, acc);
  }

  const goods = po ? receivingProgress(po) : null;
  const pay = po ? paymentProgress(po) : null;
  const due = po ? dueStatus(po.dueDate, po.paymentStatus || 'UNPAID') : null;
  const cancelled = po?.status === 'CANCELLED';
  const receivable = !!po && canReceive(po);
  const cancellable = !!po && !!onCancel && canCancel(po);
  const statusCfg = po ? getStatusBadgeProps(po.status, poStatusMap) : null;
  const payCfg = po ? getStatusBadgeProps(po.paymentStatus || 'UNPAID', poPaymentStatusMap) : null;
  const history = po ? poHistory(po, poDetail?.goodsReceivings ?? []) : [];
  const receiveLabel = goods && goods.received > 0 && goods.remaining > 0 ? `รับสินค้าที่เหลือ ${goods.remaining} ชิ้น` : 'รับสินค้า';

  const receivedChip = (item: POItem) => {
    const done = item.receivedQty >= item.quantity;
    const variant = done ? 'success' : item.receivedQty > 0 ? 'warning' : 'secondary';
    const qc = qcByItem.get(item.id);
    return (
      <div className="flex flex-col items-end gap-1">
        <Badge variant={variant} appearance="light" className="tabular-nums">
          {item.receivedQty} / {item.quantity}
        </Badge>
        {qc && qc.qcPending > 0 && (
          <Badge variant="warning" appearance="light" className="text-[10px]">
            รอเข้าคลัง {qc.qcPending}
          </Badge>
        )}
        {qc && qc.inStock > 0 && (
          <Badge variant="success" appearance="light" className="text-[10px]">
            เข้าสต็อก {qc.inStock}
          </Badge>
        )}
      </div>
    );
  };

  return (
    <div ref={overlayRef} className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-8 pb-8 backdrop-blur-xs" role="dialog" aria-modal="true" aria-label="รายละเอียดใบสั่งซื้อ">
      <div className="flex max-h-[calc(100vh-4rem)] w-full max-w-4xl flex-col overflow-hidden rounded-xl bg-background shadow-2xl">
        {/* Sticky header: number + the two states that matter, side by side; ปิด (X / Esc) on the right */}
        <div className="sticky top-0 z-10 flex shrink-0 items-center gap-4 border-b bg-background/95 px-6 py-4 backdrop-blur-xs">
          {po && statusCfg && payCfg ? (
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <h2 className="font-mono text-lg font-semibold leading-snug text-foreground">{po.poNumber}</h2>
              <Badge variant={statusCfg.variant} appearance={statusCfg.appearance}>{statusCfg.label}</Badge>
              <Badge variant={payCfg.variant} appearance={payCfg.appearance}>{payCfg.label}</Badge>
            </div>
          ) : (
            <div className="flex-1" />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="ปิด"
            title="ปิด (Esc)"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        {po && goods && pay && due && (
          <>
            <div className="flex-1 space-y-5 overflow-y-auto p-6">
              {/* Supplier + the four facts */}
              <section className={cardCls} aria-label="สรุปใบสั่งซื้อ">
                <div className="mb-4 flex items-start justify-between gap-4 border-b border-border/50 pb-4">
                  <div className="min-w-0">
                    <div className={cn(labelCls, 'mb-1')}>ผู้จัดจำหน่าย</div>
                    <div className="text-base font-semibold leading-snug text-foreground">{po.supplier.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] leading-snug text-muted-foreground">
                      {po.supplier.contactName && <span>{po.supplier.contactName}</span>}
                      {po.supplier.phone && (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="size-3.5" aria-hidden />
                          {po.supplier.phone}
                        </span>
                      )}
                      {po.supplier.hasVat ? (
                        <Badge variant="info" appearance="light">VAT 7%</Badge>
                      ) : (
                        <Badge variant="secondary" appearance="light">ไม่มี VAT</Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className={labelCls}>ยอดสุทธิ</span>
                    <span className="font-mono text-xl font-semibold tabular-nums text-foreground">{money(pay.net)} บาท</span>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
                  <div>
                    <dt className={labelCls}>วันที่สั่ง</dt>
                    <dd className="leading-snug text-foreground">{formatDateShort(po.orderDate)}</dd>
                  </div>
                  <div>
                    <dt className={labelCls}>คาดว่าจะได้รับ</dt>
                    <dd className="leading-snug text-foreground">{po.expectedDate ? formatDateShort(po.expectedDate) : '-'}</dd>
                  </div>
                  <div>
                    <dt className={labelCls}>ครบกำหนดชำระ</dt>
                    <dd className={cn('leading-snug', due.overdue ? 'font-semibold text-destructive' : 'text-foreground')}>
                      {po.dueDate ? formatDateMedium(po.dueDate) : '-'}
                      {due.overdue && ' (เลยกำหนด!)'}
                    </dd>
                  </div>
                  <div>
                    <dt className={labelCls}>ผู้สร้าง</dt>
                    <dd className="leading-snug text-foreground">{po.createdBy.name}</dd>
                  </div>
                </dl>
              </section>

              {/* Two independent tracks: goods and money */}
              <div className="grid gap-5 sm:grid-cols-2">
                <section className={cn(cardCls, 'flex flex-col gap-3')} aria-label="ความคืบหน้าการรับสินค้า">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className={cn('flex size-8 items-center justify-center rounded-lg', goods.remaining === 0 && goods.total > 0 ? 'bg-success/10 text-success' : 'bg-warning/10 text-warning')}>
                        <Truck className="size-4.5" aria-hidden />
                      </div>
                      <span className="text-sm font-semibold text-foreground">รับสินค้า</span>
                    </div>
                    {receivable && (
                      <button type="button" onClick={() => openReceiveModal(po)} className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                        รับสินค้า
                      </button>
                    )}
                  </div>
                  <div>
                    <div className={cn(labelCls, 'mb-0.5')}>รับแล้ว</div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono text-2xl font-semibold tabular-nums text-foreground" data-testid="goods-progress">
                        {goods.received} / {goods.total}
                      </span>
                      <span className="text-sm text-muted-foreground">ชิ้น</span>
                    </div>
                  </div>
                  <ProgressBar pct={goods.pct} tone={goods.remaining === 0 && goods.total > 0 ? 'success' : 'warning'} />
                  <p className="text-xs leading-snug text-muted-foreground">
                    {goods.total > 0 && goods.remaining === 0
                      ? 'รับครบแล้ว'
                      : goods.received === 0
                        ? `ยังไม่ได้รับของ${po.expectedDate ? ` · คาดว่าจะได้รับ ${formatDateShort(po.expectedDate)}` : ''}`
                        : `เหลืออีก ${goods.remaining} ชิ้น${po.expectedDate ? ` · คาดว่าจะได้รับ ${formatDateShort(po.expectedDate)}` : ''}`}
                  </p>
                </section>

                <section className={cn(cardCls, 'flex flex-col gap-3')} aria-label="ความคืบหน้าการจ่ายเงิน">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <div className={cn('flex size-8 items-center justify-center rounded-lg', pay.pct >= 100 ? 'bg-success/10 text-success' : pay.pct > 0 ? 'bg-warning/10 text-warning' : 'bg-destructive/10 text-destructive')}>
                        <Coins className="size-4.5" aria-hidden />
                      </div>
                      <span className="text-sm font-semibold text-foreground">การจ่ายเงิน</span>
                    </div>
                    {!cancelled && (
                      <button type="button" onClick={() => openPaymentModal(po)} className="rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-accent">
                        บันทึกการจ่าย
                      </button>
                    )}
                  </div>
                  <div>
                    <div className={cn(labelCls, 'mb-0.5')}>จ่ายแล้ว</div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono text-2xl font-semibold tabular-nums text-foreground" data-testid="paid-progress">{money(pay.paid)}</span>
                      <span className="text-sm text-muted-foreground">/ {money(pay.net)} บาท</span>
                    </div>
                  </div>
                  <ProgressBar pct={pay.pct} tone="success" />
                  <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-snug text-muted-foreground">
                    <Badge variant={payCfg!.variant} appearance={payCfg!.appearance}>{payCfg!.label}</Badge>
                    {pay.remaining > 0 && <span>คงค้าง {money(pay.remaining)} บาท</span>}
                    {po.dueDate && (
                      <span className={cn(due.overdue && 'font-semibold text-destructive')}>
                        · ครบกำหนด {formatDateMedium(po.dueDate)}
                        {due.text && ` (${due.text})`}
                      </span>
                    )}
                    {po.paymentMethod && <span>· {paymentMethodLabels[po.paymentMethod] ?? po.paymentMethod}</span>}
                  </p>
                  {po.paymentNotes && <p className="text-xs leading-snug text-muted-foreground">บันทึกการจ่าย: {po.paymentNotes}</p>}
                </section>
              </div>

              {/* Items — the same columns the purchase wizard shows, plus รับแล้ว */}
              <section className={cardCls} aria-label="รายการสินค้า">
                <CardHeader icon={<Package className="size-4.5" aria-hidden />} tone="bg-warning/10 text-warning" title="รายการสินค้า" sub={`${po.items.length} รายการ · ${goods.total} ชิ้น`} />
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-180 table-fixed border-collapse text-sm">
                    <colgroup>
                      <col className="w-8" />
                      <col />
                      <col className="w-18" />
                      <col className="w-21" />
                      <col className="w-26" />
                      <col className="w-16" />
                      <col className="w-23" />
                      <col className="w-25" />
                      <col className="w-23" />
                    </colgroup>
                    <thead className="bg-muted/50">
                      <tr>
                        <th className={thCls}>#</th>
                        <th className={thCls}>รุ่น</th>
                        <th className={thCls}>สภาพ</th>
                        <th className={thCls}>ความจุ</th>
                        <th className={thCls}>สี</th>
                        <th className={cn(thCls, 'text-right')}>จำนวน</th>
                        <th className={cn(thCls, 'text-right')}>ราคา/ชิ้น</th>
                        <th className={cn(thCls, 'text-right')}>รับแล้ว</th>
                        <th className={cn(thCls, 'text-right')}>รวม</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {po.items.map((item, idx) => (
                        <tr key={item.id} className={cn(isAccessory(item) && 'bg-primary/5')} aria-label={`รายการ #${idx + 1}`}>
                          <td className={cn(tdCls, 'text-xs tabular-nums text-muted-foreground')}>{idx + 1}</td>
                          {isAccessory(item) ? (
                            <>
                              <td className={tdCls}>
                                <div className="font-semibold leading-snug text-foreground">{accessoryTitle(item)}</div>
                                <div className="text-xs leading-snug text-primary">อุปกรณ์เสริม</div>
                              </td>
                              <td className={tdCls} colSpan={3}>
                                <span className="text-foreground">{accessoryFor(item) ?? '-'}</span>
                              </td>
                            </>
                          ) : (
                            <>
                              <td className={tdCls}>
                                <div className="truncate font-semibold leading-snug text-foreground">{item.model}</div>
                                <div className="text-xs leading-snug text-muted-foreground">{item.brand}</div>
                              </td>
                              <td className={tdCls}>{itemCondition(item)}</td>
                              <td className={tdCls}>{item.storage || '-'}</td>
                              <td className={tdCls}>{item.color || '-'}</td>
                            </>
                          )}
                          <td className={cn(tdCls, 'text-right tabular-nums')}>{item.quantity}</td>
                          <td className={cn(tdCls, 'text-right font-mono tabular-nums')}>{money(item.unitPrice)}</td>
                          <td className={cn(tdCls, 'text-right')}>{receivedChip(item)}</td>
                          <td className={cn(tdCls, 'text-right font-mono font-semibold tabular-nums')}>{money(item.quantity * Number(item.unitPrice))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <span className="pt-0.5 text-sm text-muted-foreground">รวม {po.items.length} รายการ · {goods.total} ชิ้น</span>
                  <div className="w-full space-y-1.5 text-sm sm:w-80">
                    {Number(po.vatAmount) > 0 ? (
                      <>
                        <div className="flex justify-between"><span className="text-muted-foreground">มูลค่าสินค้า (ก่อน VAT 7%)</span><span className="tabular-nums">{money(po.totalAmount)} บาท</span></div>
                        {Number(po.discount) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">ส่วนลด (ก่อน VAT 7%)</span><span className="tabular-nums text-destructive">-{money(po.discount)} บาท</span></div>}
                        <div className="flex justify-between"><span className="text-muted-foreground">VAT 7%</span><span className="tabular-nums">{money(po.vatAmount)} บาท</span></div>
                        {Number(po.discountAfterVat) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">ส่วนลด (หลัง VAT 7%)</span><span className="tabular-nums text-destructive">-{money(po.discountAfterVat)} บาท</span></div>}
                      </>
                    ) : (
                      <>
                        <div className="flex justify-between"><span className="text-muted-foreground">ยอดรวมสินค้า</span><span className="tabular-nums">{money(po.totalAmount)} บาท</span></div>
                        {Number(po.discount) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">ส่วนลด</span><span className="tabular-nums text-destructive">-{money(po.discount)} บาท</span></div>}
                      </>
                    )}
                    <div className="flex justify-between border-t border-border/50 pt-1.5 font-semibold"><span>ยอดสุทธิ</span><span className="font-mono tabular-nums" data-testid="net-amount">{money(pay.net)} บาท</span></div>
                  </div>
                </div>
              </section>

              {/* One line of history: created / ordered / every goods receiving / cancel */}
              <section className={cardCls} aria-label="ประวัติ">
                <CardHeader icon={<History className="size-4.5" aria-hidden />} tone="bg-info/10 text-info" title="ประวัติ" sub="ทุกอย่างที่เกิดกับใบนี้ เรียงล่าสุดขึ้นก่อน" />
                <ol className="flex flex-col">
                  {history.map((ev, i) => {
                    const last = i === history.length - 1;
                    return (
                      <li key={ev.key} className={cn('grid grid-cols-[20px_minmax(0,1fr)] gap-3', !last && 'pb-4')}>
                        <div className="flex flex-col items-center">
                          <span className={cn('mt-1 size-3 shrink-0 rounded-full ring-[3px]', TONE_DOT[ev.tone])} aria-hidden />
                          {!last && <span className="mt-1.5 w-0.5 flex-1 bg-muted" aria-hidden />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-sm font-semibold leading-snug text-foreground">{ev.title}</span>
                            <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{ev.at ? formatDateTime(ev.at) : '-'}</span>
                          </div>
                          {(ev.by || ev.detail) && (
                            <div className="text-xs leading-snug text-muted-foreground">
                              {ev.by && `โดย ${ev.by}`}
                              {ev.by && ev.detail && ' · '}
                              {ev.detail}
                            </div>
                          )}
                          {ev.receiving && (
                            <div className="mt-1.5 space-y-1">
                              {ev.receiving.items.map((ri) => (
                                <div key={ri.id} className="flex flex-wrap items-center gap-2 text-xs">
                                  <Badge variant={ri.status === 'PASS' ? 'success' : 'destructive'} appearance="light">{ri.status === 'PASS' ? 'PASS' : 'REJECT'}</Badge>
                                  {ri.imeiSerial && <span className="font-mono text-muted-foreground">IMEI: {ri.imeiSerial}</span>}
                                  {ri.serialNumber && <span className="font-mono text-muted-foreground">SN: {ri.serialNumber}</span>}
                                  {ri.rejectReason && <span className="text-destructive">({ri.rejectReason})</span>}
                                </div>
                              ))}
                              {ev.receiving.notes && <div className="text-xs text-muted-foreground">หมายเหตุ: {ev.receiving.notes}</div>}
                              <button
                                type="button"
                                onClick={() => navigate(`/purchase-orders/${po.id}/goods-receivings/${ev.receiving!.id}/print`)}
                                className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent"
                                aria-label={`พิมพ์ใบรับของ ${ev.receiving.grNumber}`}
                              >
                                <Printer className="size-3.5" aria-hidden />
                                พิมพ์ใบรับของ
                              </button>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
                {history.length === 1 && !cancelled && (
                  <p className="mt-3 rounded-lg bg-muted/50 px-3 py-2.5 text-xs leading-snug text-muted-foreground">
                    ถัดไป: รับสินค้าเมื่อของมาถึง · บันทึกการจ่ายเมื่อโอนให้ผู้ขาย — จะขึ้นเป็นรายการในนี้เอง
                  </p>
                )}
              </section>

              {po.notes && (
                <section className={cardCls} aria-label="หมายเหตุ">
                  <CardHeader icon={<PencilLine className="size-4.5" aria-hidden />} tone="bg-warning/10 text-warning" title="หมายเหตุ" sub="ติดไปกับใบสั่งซื้อ" />
                  <p className="text-sm leading-relaxed text-foreground">{po.notes}</p>
                </section>
              )}

              {po.attachments && po.attachments.length > 0 && (
                <section className={cardCls} aria-label="เอกสารแนบ">
                  <CardHeader icon={<Paperclip className="size-4.5" aria-hidden />} tone="bg-primary/10 text-primary" title="เอกสารแนบ" sub={`${po.attachments.length} ไฟล์`} />
                  <div className="flex flex-wrap gap-2">
                    {po.attachments.map((att, idx) =>
                      att.startsWith('data:image') ? (
                        <a key={idx} href={att} target="_blank" rel="noopener noreferrer">
                          <img src={att} alt={`สลิป ${idx + 1}`} className="size-20 rounded-lg border object-cover transition-opacity hover:opacity-80" />
                        </a>
                      ) : (
                        <a key={idx} href={att} target="_blank" rel="noopener noreferrer" className="block max-w-50 truncate text-xs text-primary hover:underline">
                          {att}
                        </a>
                      ),
                    )}
                  </div>
                </section>
              )}
            </div>

            {(cancellable || receivable || !cancelled) && (
              <div className="sticky bottom-0 flex shrink-0 items-center justify-between gap-3 border-t bg-background/95 px-6 py-4 backdrop-blur-xs">
                <div>
                  {cancellable && (
                    <button type="button" onClick={() => onCancel!(po)} className="rounded-lg px-3 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10">
                      ยกเลิก PO
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {!cancelled && (
                    <button type="button" onClick={() => openPaymentModal(po)} className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent">
                      บันทึกการจ่าย
                    </button>
                  )}
                  {receivable && (
                    <button type="button" onClick={() => openReceiveModal(po)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90">
                      <Truck className="size-4" aria-hidden />
                      {receiveLabel}
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
