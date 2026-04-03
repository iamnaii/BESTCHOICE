import Modal from '@/components/ui/Modal';
import { PurchaseOrder, PODetail, POItem } from '../types';
import { statusLabels, statusColors, paymentStatusLabels, paymentStatusColors } from '../constants';

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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`รายละเอียด PO - ${selectedPO?.poNumber || ''}`}
      size="xl"
    >
      {selectedPO && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">ผู้ขาย:</span>{' '}
              <span className="font-medium">{selectedPO.supplier.name}</span>
            </div>
            <div>
              <span className="text-muted-foreground">สถานะ:</span>{' '}
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${statusColors[selectedPO.status] || ''}`}>
                {statusLabels[selectedPO.status] || selectedPO.status}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">วันที่สั่ง:</span>{' '}
              {new Date(selectedPO.orderDate).toLocaleDateString('th-TH')}
            </div>
            {selectedPO.dueDate && (
              <div>
                <span className="text-muted-foreground">ครบกำหนดชำระ:</span>{' '}
                <span className={new Date(selectedPO.dueDate) < new Date() && selectedPO.paymentStatus !== 'FULLY_PAID' ? 'text-destructive font-semibold' : ''}>
                  {new Date(selectedPO.dueDate).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' })}
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
            <div>
              <span className="text-muted-foreground">การจ่ายเงิน:</span>{' '}
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${paymentStatusColors[selectedPO.paymentStatus] || 'bg-muted text-foreground'}`}>
                {paymentStatusLabels[selectedPO.paymentStatus] || 'ยังไม่จ่าย'}
              </span>
              {selectedPO.paymentMethod && (
                <span className="ml-1 text-xs text-muted-foreground">
                  ({selectedPO.paymentMethod === 'CASH' ? 'เงินสด' : selectedPO.paymentMethod === 'BANK_TRANSFER' ? 'โอน' : selectedPO.paymentMethod === 'CHECK' ? 'เช็ค' : selectedPO.paymentMethod === 'CREDIT' ? 'เครดิต' : selectedPO.paymentMethod})
                </span>
              )}
              {Number(selectedPO.paidAmount) > 0 && (
                <span className="ml-1 text-muted-foreground">({Number(selectedPO.paidAmount).toLocaleString()} บาท)</span>
              )}
            </div>
          </div>

          {/* Summary */}
          {(Number(selectedPO.discount) > 0 || Number(selectedPO.vatAmount) > 0) && (
            <div className="bg-muted rounded-lg p-3 text-sm space-y-1">
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
                        <span className="text-amber-700 font-semibold">
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
                      className="bg-green-500 h-1.5 rounded-full"
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
            <div className="text-sm">
              <span className="text-muted-foreground">หมายเหตุการจ่ายเงิน:</span> {selectedPO.paymentNotes}
            </div>
          )}

          {/* Attachments in detail */}
          {selectedPO.attachments && selectedPO.attachments.length > 0 && (
            <div className="text-sm">
              <span className="text-muted-foreground">เอกสารแนบ:</span>
              <div className="mt-1 flex flex-wrap gap-2">
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

          <div>
            <h4 className="text-sm font-medium text-foreground mb-2">รายการสินค้า</h4>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted">
                  <th className="px-3 py-2 text-left">ยี่ห้อ</th>
                  <th className="px-3 py-2 text-left">รุ่น</th>
                  <th className="px-3 py-2 text-left">รายละเอียด</th>
                  <th className="px-3 py-2 text-right">จำนวน</th>
                  <th className="px-3 py-2 text-right">ราคา/ชิ้น</th>
                  <th className="px-3 py-2 text-right">รับแล้ว</th>
                  <th className="px-3 py-2 text-right">คงเหลือ</th>
                  <th className="px-3 py-2 text-right">รวม</th>
                </tr>
              </thead>
              <tbody>
                {selectedPO.items.map((item) => (
                  <tr key={item.id} className="border-b">
                    <td className="px-3 py-2">
                      {item.brand}
                      {item.category === 'ACCESSORY' && (
                        <div className="text-xs text-primary">(อุปกรณ์เสริม)</div>
                      )}
                    </td>
                    <td className="px-3 py-2">{item.model}</td>
                    <td className="px-3 py-2 text-muted-foreground">{getItemDesc(item)}</td>
                    <td className="px-3 py-2 text-right">{item.quantity}</td>
                    <td className="px-3 py-2 text-right">{Number(item.unitPrice).toLocaleString()}</td>
                    <td className="px-3 py-2 text-right">
                      <span className={item.receivedQty >= item.quantity ? 'text-success font-medium' : 'text-yellow-600'}>
                        {item.receivedQty}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <span className={item.quantity - item.receivedQty > 0 ? 'text-destructive' : 'text-success'}>
                        {item.quantity - item.receivedQty}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {(item.quantity * Number(item.unitPrice)).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selectedPO.notes && (
            <div className="text-sm">
              <span className="text-muted-foreground">หมายเหตุ:</span> {selectedPO.notes}
            </div>
          )}

          {/* Goods Receiving History */}
          {poDetail?.goodsReceivings && poDetail.goodsReceivings.length > 0 && (
            <div>
              <h4 className="text-sm font-medium text-foreground mb-2">ประวัติการรับสินค้า</h4>
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
                            {new Date(gr.createdAt).toLocaleString('th-TH')}
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
                            <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                              item.status === 'PASS' ? 'bg-success/5 dark:bg-success/10 text-success' : 'bg-destructive/5 dark:bg-destructive/10 text-destructive'
                            }`}>
                              {item.status === 'PASS' ? 'PASS' : 'REJECT'}
                            </span>
                            {item.imeiSerial && (
                              <span className="font-mono text-muted-foreground">IMEI: {item.imeiSerial}</span>
                            )}
                            {item.serialNumber && (
                              <span className="font-mono text-muted-foreground">SN: {item.serialNumber}</span>
                            )}
                            {item.rejectReason && (
                              <span className="text-red-500">({item.rejectReason})</span>
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

          {/* Receive button in detail modal */}
          {['APPROVED', 'PARTIALLY_RECEIVED'].includes(selectedPO.status) && (
            <div className="flex justify-end pt-2 border-t">
              <button
                onClick={() => openReceiveModal(selectedPO)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                รับสินค้า
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
