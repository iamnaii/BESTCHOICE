import { formatDateShort, formatDateMedium, formatDateTime } from '@/utils/formatters';
import { PurchaseOrder, PODetail, POItem } from '../types';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, poStatusMap, poPaymentStatusMap } from '@/lib/status-badges';

export interface PODetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPO: PurchaseOrder | null;
  poDetail: PODetail | null;
  openReceiveModal: (po: PurchaseOrder) => void;
  openPaymentModal: (po: PurchaseOrder) => void;
}

export function PODetailModal({
  isOpen,
  onClose,
  selectedPO,
  poDetail,
  openReceiveModal,
  openPaymentModal,
}: PODetailModalProps) {
  const getItemDesc = (item: POItem) => {
    if (item.category === 'ACCESSORY') {
      const isCharger = item.accessoryType === 'ชุดชาร์จ';
      const parts: string[] = [];
      if (item.accessoryType) parts.push(item.accessoryType);
      if (item.accessoryBrand) parts.push(item.accessoryBrand);
      if (item.model) parts.push(isCharger ? item.model : `สำหรับ ${item.model}`);
      return parts.length > 0 ? parts.join(' / ') : '-';
    }
    const parts = [item.color, item.storage].filter(Boolean);
    return parts.length > 0 ? parts.join(' / ') : '-';
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8" role="dialog" aria-modal="true" aria-label="รายละเอียดใบสั่งซื้อ">
      <div className="w-full max-w-3xl bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between shrink-0">
          <button type="button" onClick={onClose} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            กลับ
          </button>
          <h2 className="text-lg font-semibold text-foreground">รายละเอียด PO - {selectedPO?.poNumber || ''}</h2>
          <div className="w-16" />
        </div>

        {selectedPO && (
          <>
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* ข้อมูลทั่วไป */}
              <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/></svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">ข้อมูลทั่วไป</h3>
                    <p className="text-xs text-muted-foreground">รายละเอียดใบสั่งซื้อ</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-muted-foreground">ผู้ขาย:</span>{' '}
                    <span className="font-medium">{selectedPO.supplier.name}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">สถานะ:</span>{' '}
                    {(() => { const cfg = getStatusBadgeProps(selectedPO.status, poStatusMap); return <Badge variant={cfg.variant} appearance={cfg.appearance}>{cfg.label}</Badge>; })()}
                  </div>
                  <div>
                    <span className="text-muted-foreground">วันที่สั่ง:</span>{' '}
                    {formatDateShort(selectedPO.orderDate)}
                  </div>
                  {selectedPO.dueDate && (
                    <div>
                      <span className="text-muted-foreground">ครบกำหนดชำระ:</span>{' '}
                      <span className={new Date(selectedPO.dueDate) < new Date() && selectedPO.paymentStatus !== 'FULLY_PAID' ? 'text-destructive font-semibold' : ''}>
                        {formatDateMedium(selectedPO.dueDate)}
                        {new Date(selectedPO.dueDate) < new Date() && selectedPO.paymentStatus !== 'FULLY_PAID' && ' (เลยกำหนด!)'}
                      </span>
                    </div>
                  )}
                  <div>
                    <span className="text-muted-foreground">ผู้สร้าง:</span> {selectedPO.createdBy.name}
                  </div>
                  <div>
                    <span className="text-muted-foreground">ยอดสุทธิ:</span>{' '}
                    <span className="font-medium">{Number(selectedPO.netAmount ?? selectedPO.totalAmount).toLocaleString()} บาท</span>
                  </div>
                </div>
              </div>

              {/* การจ่ายเงิน */}
              <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="flex items-center justify-center size-8 rounded-lg bg-success/10 text-success">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 17a5 5 0 0 0 10 0c0-2.76-2.24-5-5-5s-5 2.24-5 5Z"/><path d="M12 17a5 5 0 0 0 10 0c0-2.76-2.24-5-5-5s-5 2.24-5 5Z"/><path d="M7 7a5 5 0 0 0 10 0c0-2.76-2.24-5-5-5S7 4.24 7 7Z"/></svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">การจ่ายเงิน</h3>
                    <p className="text-xs text-muted-foreground">สถานะและรายละเอียดการชำระ</p>
                  </div>
                </div>
                <div className="text-sm mb-3">
                  <span className="text-muted-foreground">การจ่ายเงิน:</span>{' '}
                  {(() => { const cfg = getStatusBadgeProps(selectedPO.paymentStatus || 'UNPAID', poPaymentStatusMap); return <Badge variant={cfg.variant} appearance={cfg.appearance}>{cfg.label}</Badge>; })()}
                  {selectedPO.paymentMethod && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      ({selectedPO.paymentMethod === 'CASH' ? 'เงินสด' : selectedPO.paymentMethod === 'BANK_TRANSFER' ? 'โอน' : selectedPO.paymentMethod === 'CHECK' ? 'เช็ค' : selectedPO.paymentMethod === 'CREDIT' ? 'เครดิต' : selectedPO.paymentMethod})
                    </span>
                  )}
                  {Number(selectedPO.paidAmount) > 0 && (
                    <span className="ml-1 text-muted-foreground">({Number(selectedPO.paidAmount).toLocaleString()} บาท)</span>
                  )}
                </div>

                {/* Summary */}
                {(Number(selectedPO.discount) > 0 || Number(selectedPO.vatAmount) > 0) && (
                  <div className="bg-muted rounded-lg p-3 text-sm space-y-1 mb-3">
                    <div className="flex justify-between"><span className="text-muted-foreground">ยอดรวมสินค้า</span><span>{Number(selectedPO.totalAmount).toLocaleString()} บาท</span></div>
                    {Number(selectedPO.discount) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">ส่วนลด</span><span className="text-destructive">-{Number(selectedPO.discount).toLocaleString()} บาท</span></div>}
                    {Number(selectedPO.vatAmount) > 0 && <div className="flex justify-between"><span className="text-muted-foreground">VAT 7%</span><span>{Number(selectedPO.vatAmount).toLocaleString()} บาท</span></div>}
                    <div className="flex justify-between font-semibold border-t pt-1"><span>ยอดสุทธิ</span><span>{Number(selectedPO.netAmount).toLocaleString()} บาท</span></div>
                  </div>
                )}

                {/* Payment info bar */}
                {selectedPO.status !== 'CANCELLED' && (
                  <div className="bg-muted border rounded-lg p-3 flex items-center justify-between">
                    <div className="text-sm flex-1">
                      <div className="flex items-baseline gap-3 flex-wrap">
                        <span>
                          <span className="text-muted-foreground">จ่ายแล้ว:</span>{' '}
                          <span className="font-medium text-lg text-success">{Number(selectedPO.paidAmount || 0).toLocaleString()}</span>
                          <span className="text-muted-foreground"> / {Number(selectedPO.netAmount ?? selectedPO.totalAmount).toLocaleString()} บาท</span>
                        </span>
                        {(() => {
                          const net = Number(selectedPO.netAmount ?? selectedPO.totalAmount);
                          const paid = Number(selectedPO.paidAmount || 0);
                          const remaining = net - paid;
                          if (remaining > 0 && paid > 0) {
                            return (
                              <span className="text-warning font-semibold">
                                คงเหลือ {remaining.toLocaleString()} บาท
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </div>
                      {Number(selectedPO.netAmount ?? selectedPO.totalAmount) > 0 && (
                        <div className="w-full bg-secondary rounded-full h-1.5 mt-1">
                          <div
                            className="bg-success h-1.5 rounded-full"
                            style={{ width: `${Math.min((Number(selectedPO.paidAmount || 0) / Number(selectedPO.netAmount ?? selectedPO.totalAmount)) * 100, 100)}%` }}
                          />
                        </div>
                      )}
                    </div>
                    <button
                      onClick={() => openPaymentModal(selectedPO)}
                      className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                    >
                      อัปเดตการจ่ายเงิน
                    </button>
                  </div>
                )}

                {selectedPO.paymentNotes && (
                  <div className="text-sm mt-3">
                    <span className="text-muted-foreground">หมายเหตุการจ่ายเงิน:</span> {selectedPO.paymentNotes}
                  </div>
                )}
              </div>

              {/* เอกสารแนบ */}
              {selectedPO.attachments && selectedPO.attachments.length > 0 && (
                <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">เอกสารแนบ</h3>
                      <p className="text-xs text-muted-foreground">{selectedPO.attachments.length} ไฟล์</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {selectedPO.attachments.map((att, idx) =>
                      att.startsWith('data:image') ? (
                        <a key={idx} href={att} target="_blank" rel="noopener noreferrer">
                          <img src={att} alt={`สลิป ${idx + 1}`} className="h-20 w-20 object-cover rounded-lg border hover:opacity-80 transition-opacity" />
                        </a>
                      ) : (
                        <a key={idx} href={att} target="_blank" rel="noopener noreferrer" className="block text-xs text-primary hover:underline truncate max-w-[200px]">{att}</a>
                      )
                    )}
                  </div>
                </div>
              )}

              {/* รายการสินค้า */}
              <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="flex items-center justify-center size-8 rounded-lg bg-warning/10 text-warning">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">รายการสินค้า</h3>
                    <p className="text-xs text-muted-foreground">{selectedPO.items.length} รายการ</p>
                  </div>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/40 text-xs text-muted-foreground border-b border-border/50">
                      <th className="px-3 py-2.5 text-left font-semibold">ยี่ห้อ</th>
                      <th className="px-3 py-2.5 text-left font-semibold">รุ่น</th>
                      <th className="px-3 py-2.5 text-left font-semibold">รายละเอียด</th>
                      <th className="px-3 py-2.5 text-right font-semibold">จำนวน</th>
                      <th className="px-3 py-2.5 text-right font-semibold">ราคา/ชิ้น</th>
                      <th className="px-3 py-2.5 text-right font-semibold">รับแล้ว</th>
                      <th className="px-3 py-2.5 text-right font-semibold">คงเหลือ</th>
                      <th className="px-3 py-2.5 text-right font-semibold">รวม</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {selectedPO.items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-3 py-2">
                          {item.brand}
                          {item.category === 'ACCESSORY' && (
                            <div className="text-xs text-primary">(อุปกรณ์เสริม)</div>
                          )}
                        </td>
                        <td className="px-3 py-2">{item.model}</td>
                        <td className="px-3 py-2 text-muted-foreground">{getItemDesc(item)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{item.quantity}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-mono">{Number(item.unitPrice).toLocaleString()}</td>
                        <td className="px-3 py-2.5 text-right">
                          <span className={item.receivedQty >= item.quantity ? 'text-success font-semibold' : 'text-warning font-medium'}>
                            {item.receivedQty}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className={item.quantity - item.receivedQty > 0 ? 'text-destructive font-semibold' : 'text-success font-semibold'}>
                            {item.quantity - item.receivedQty}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-mono">
                          {(item.quantity * Number(item.unitPrice)).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* หมายเหตุ */}
              {selectedPO.notes && (
                <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="flex items-center justify-center size-8 rounded-lg bg-warning/10 text-warning">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.855z"/></svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">หมายเหตุ</h3>
                      <p className="text-xs text-muted-foreground">บันทึกเพิ่มเติม</p>
                    </div>
                  </div>
                  <p className="text-sm">{selectedPO.notes}</p>
                </div>
              )}

              {/* ประวัติการรับสินค้า */}
              {poDetail?.goodsReceivings && poDetail.goodsReceivings.length > 0 && (
                <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="flex items-center justify-center size-8 rounded-lg bg-info/10 text-info">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/><path d="m9 12 2 2 4-4"/></svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">ประวัติการรับสินค้า</h3>
                      <p className="text-xs text-muted-foreground">{poDetail.goodsReceivings.length} ครั้ง</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    {poDetail.goodsReceivings.map((gr) => {
                      const passCount = gr.items.filter((i) => i.status === 'PASS').length;
                      const rejectCount = gr.items.filter((i) => i.status === 'REJECT').length;
                      return (
                        <div key={gr.id} className="border rounded-lg p-3">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-sm">
                              <span className="font-medium">{gr.receivedBy.name}</span>
                              <span className="text-muted-foreground ml-2">
                                {formatDateTime(gr.createdAt)}
                              </span>
                            </div>
                            <div className="flex gap-2">
                              <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-success/10 text-success dark:bg-success/15">
                                ผ่าน {passCount}
                              </span>
                              {rejectCount > 0 && (
                                <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-destructive/10 text-destructive dark:bg-destructive/15">
                                  ไม่ผ่าน {rejectCount}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="space-y-1">
                            {gr.items.map((item) => (
                              <div key={item.id} className="flex items-center gap-2 text-xs">
                                <Badge variant={item.status === 'PASS' ? 'success' : 'destructive'} appearance="light">
                                  {item.status === 'PASS' ? 'PASS' : 'REJECT'}
                                </Badge>
                                {item.imeiSerial && (
                                  <span className="font-mono text-muted-foreground">IMEI: {item.imeiSerial}</span>
                                )}
                                {item.serialNumber && (
                                  <span className="font-mono text-muted-foreground">SN: {item.serialNumber}</span>
                                )}
                                {item.rejectReason && (
                                  <span className="text-destructive">({item.rejectReason})</span>
                                )}
                              </div>
                            ))}
                          </div>
                          {gr.notes && <div className="text-xs text-muted-foreground mt-1">หมายเหตุ: {gr.notes}</div>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Sticky Footer */}
            {['APPROVED', 'PARTIALLY_RECEIVED'].includes(selectedPO.status) && (
              <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 flex justify-end gap-3 shrink-0">
                <button
                  onClick={() => openReceiveModal(selectedPO)}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  รับสินค้า
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
