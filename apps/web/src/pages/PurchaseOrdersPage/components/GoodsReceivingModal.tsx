import { UseMutationResult } from '@tanstack/react-query';
import { PurchaseOrder, ReceivingUnitForm } from '../types';
import { checklistCategories } from '../constants';
import ThaiDateInput from '@/components/ui/ThaiDateInput';

export interface GoodsReceivingModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedPO: PurchaseOrder | null;
  receivingUnits: ReceivingUnitForm[];
  setReceivingUnits: React.Dispatch<React.SetStateAction<ReceivingUnitForm[]>>;
  receivingNotes: string;
  setReceivingNotes: (value: string) => void;
  goodsReceivingMutation: UseMutationResult<unknown, unknown, { poId: string; items: ReceivingUnitForm[]; notes: string }, unknown>;
  updateReceivingUnit: (idx: number, field: string, value: string) => void;
  updateChecklist: (unitIdx: number, checkIdx: number, field: 'passed' | 'note', value: boolean | string) => void;
  handleGoodsReceiving: (e: React.FormEvent) => void;
}

export function GoodsReceivingModal({
  isOpen,
  onClose,
  selectedPO,
  receivingUnits,
  receivingNotes,
  setReceivingNotes,
  goodsReceivingMutation,
  updateReceivingUnit,
  updateChecklist,
  handleGoodsReceiving,
}: GoodsReceivingModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8" role="dialog" aria-modal="true" aria-label="รับสินค้า">
      <div className="w-full max-w-3xl bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between shrink-0">
          <button type="button" onClick={onClose} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            กลับ
          </button>
          <h2 className="text-lg font-semibold text-foreground">รับสินค้า - {selectedPO?.poNumber || ''}</h2>
          <div className="w-16" />
        </div>

        {selectedPO && (
          <form onSubmit={handleGoodsReceiving} className="flex flex-col flex-1 overflow-hidden">
            {/* Scrollable content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-5">
              {/* คำแนะนำ */}
              <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">คำแนะนำ</h3>
                    <p className="text-xs text-muted-foreground">ขั้นตอนการตรวจรับสินค้า</p>
                  </div>
                </div>
                <div className="text-sm text-primary-700">
                  ตรวจรับสินค้าทีละชิ้น ระบุ IMEI/Serial ราคาขาย แล้วเลือกผลตรวจ (ผ่าน/ไม่ผ่าน)
                  <br />
                  สินค้าที่ผ่านจะเข้าสถานะ QC_PENDING รอยืนยันก่อนเข้าคลัง
                </div>
              </div>

              {/* รายการตรวจรับ */}
              <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="flex items-center justify-center size-8 rounded-lg bg-warning/10 text-warning">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">รายการตรวจรับ</h3>
                    <p className="text-xs text-muted-foreground">{receivingUnits.length} รายการ</p>
                  </div>
                </div>

                <div className="space-y-3">
                  {receivingUnits.map((unit, idx) => (
                    <div key={idx} className={`border rounded-lg p-3 ${unit.status === 'REJECT' ? 'border-destructive/30 bg-destructive/5' : 'border-border'}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium">{unit.label}</span>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => updateReceivingUnit(idx, 'status', 'PASS')}
                            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                              unit.status === 'PASS'
                                ? 'bg-success text-success-foreground'
                                : 'bg-muted text-muted-foreground hover:bg-success/10'
                            }`}
                          >
                            ผ่าน
                          </button>
                          <button
                            type="button"
                            onClick={() => updateReceivingUnit(idx, 'status', 'REJECT')}
                            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                              unit.status === 'REJECT'
                                ? 'bg-destructive text-destructive-foreground'
                                : 'bg-muted text-muted-foreground hover:bg-destructive/10'
                            }`}
                          >
                            ไม่ผ่าน
                          </button>
                        </div>
                      </div>
                      {unit.category !== 'ACCESSORY' && unit.status === 'PASS' && (
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-xs text-muted-foreground mb-0.5">IMEI <span className="text-destructive">*</span></label>
                          <input
                            type="text"
                            placeholder="IMEI"
                            value={unit.imeiSerial}
                            onChange={(e) => updateReceivingUnit(idx, 'imeiSerial', e.target.value)}
                            required
                            className="w-full px-2 py-1.5 border border-input rounded text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden font-mono"
                          />
                        </div>
                        <div>
                          <label className="block text-xs text-muted-foreground mb-0.5">หมายเลขซีเรียล <span className="text-destructive">*</span></label>
                          <input
                            type="text"
                            placeholder="หมายเลขซีเรียล"
                            value={unit.serialNumber}
                            onChange={(e) => updateReceivingUnit(idx, 'serialNumber', e.target.value)}
                            required
                            className="w-full px-2 py-1.5 border border-input rounded text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden font-mono"
                          />
                        </div>
                      </div>
                      )}
                      {unit.category === 'PHONE_USED' && unit.status === 'PASS' && (
                        <div className="mt-2 border border-warning/20 bg-warning/5 dark:bg-warning/10 rounded-lg p-3 space-y-2">
                          <div className="text-xs font-medium text-warning mb-1">ข้อมูลมือสอง</div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs text-muted-foreground mb-0.5">% แบตเตอรี่ <span className="text-destructive">*</span></label>
                              <input
                                type="number"
                                placeholder="เช่น 87"
                                value={unit.batteryHealth}
                                onChange={(e) => updateReceivingUnit(idx, 'batteryHealth', e.target.value)}
                                required
                                className="w-full px-2 py-1.5 border border-input rounded text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
                                min="0"
                                max="100"
                              />
                            </div>
                            <div>
                              <label className="block text-xs text-muted-foreground mb-0.5">กล่อง</label>
                              <div className="flex gap-2 mt-1">
                                <button
                                  type="button"
                                  onClick={() => updateReceivingUnit(idx, 'hasBox', 'true')}
                                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${unit.hasBox ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground hover:bg-success/10'}`}
                                >
                                  มีกล่อง
                                </button>
                                <button
                                  type="button"
                                  onClick={() => updateReceivingUnit(idx, 'hasBox', 'false')}
                                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${!unit.hasBox ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground hover:bg-destructive/10'}`}
                                >
                                  ไม่มีกล่อง
                                </button>
                              </div>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs text-muted-foreground mb-0.5">ประกันศูนย์ <span className="text-destructive">*</span></label>
                            <div className="flex items-center gap-3">
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={unit.warrantyExpired}
                                  onChange={(e) => updateReceivingUnit(idx, 'warrantyExpired', e.target.checked ? 'true' : 'false')}
                                  className="rounded"
                                />
                                <span className="text-xs text-muted-foreground">หมดประกันแล้ว</span>
                              </label>
                              {!unit.warrantyExpired && (
                                <ThaiDateInput
                                  value={unit.warrantyExpireDate}
                                  onChange={(e) => updateReceivingUnit(idx, 'warrantyExpireDate', e.target.value)}
                                  required
                                  className="flex-1 px-2 py-1.5 border border-input rounded text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
                                />
                              )}
                            </div>
                          </div>

                          {/* Checklist */}
                          <div className="mt-2 border-t border-warning/20 pt-2">
                            <div className="text-xs font-medium text-warning mb-2">เช็คลิสต์ตรวจเครื่อง</div>
                            {checklistCategories.map((cat) => (
                              <div key={cat} className="mb-2">
                                <div className="text-xs font-medium text-muted-foreground mb-1">{cat}</div>
                                <div className="space-y-1">
                                  {unit.checklist.map((c, checkIdx) => c.category !== cat ? null : (
                                    <div key={checkIdx} className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => updateChecklist(idx, checkIdx, 'passed', !c.passed)}
                                        className={`w-5 h-5 rounded flex items-center justify-center text-xs font-bold transition-colors ${
                                          c.passed
                                            ? 'bg-success text-success-foreground'
                                            : 'bg-destructive text-destructive-foreground'
                                        }`}
                                      >
                                        {c.passed ? '\u2713' : '\u2717'}
                                      </button>
                                      <span className={`text-xs flex-1 ${c.passed ? 'text-foreground' : 'text-destructive font-medium'}`}>
                                        {c.item}
                                      </span>
                                      {!c.passed && (
                                        <input
                                          type="text"
                                          placeholder="หมายเหตุ"
                                          value={c.note}
                                          onChange={(e) => updateChecklist(idx, checkIdx, 'note', e.target.value)}
                                          className="w-32 px-1.5 py-0.5 border border-destructive/30 rounded text-xs focus-visible:ring-1 focus-visible:ring-ring/30 outline-hidden"
                                        />
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                            <div className="text-xs text-muted-foreground mt-1">
                              ผ่าน {unit.checklist.filter((c) => c.passed).length}/{unit.checklist.length} รายการ
                            </div>
                          </div>
                        </div>
                      )}
                      {unit.status === 'PASS' && (
                        <div className="mt-2 border border-primary/20 bg-primary/5 dark:bg-primary/10 rounded-xl p-3 space-y-2">
                          <div className="text-xs font-medium text-primary mb-1">ราคาขาย</div>
                          <div>
                            <label className="block text-xs text-muted-foreground mb-0.5">ราคาขาย (บาท) <span className="text-destructive">*</span></label>
                            <input
                              type="number"
                              placeholder="เช่น 15000"
                              value={unit.sellingPrice}
                              onChange={(e) => updateReceivingUnit(idx, 'sellingPrice', e.target.value)}
                              required
                              className="w-full px-2 py-1.5 border border-input rounded text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
                              min="0"
                            />
                          </div>
                        </div>
                      )}
                      {unit.status === 'REJECT' && (
                        <input
                          type="text"
                          placeholder="เหตุผลที่ไม่ผ่าน *"
                          value={unit.rejectReason}
                          onChange={(e) => updateReceivingUnit(idx, 'rejectReason', e.target.value)}
                          required
                          className="mt-2 w-full px-2 py-1.5 border border-destructive/30 rounded text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
                        />
                      )}
                    </div>
                  ))}

                  {receivingUnits.length === 0 && (
                    <div className="text-center py-4 text-muted-foreground text-sm">
                      ไม่มีรายการที่รอรับสินค้า
                    </div>
                  )}
                </div>
              </div>

              {/* สรุปผลตรวจรับ */}
              {receivingUnits.length > 0 && (
                <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="flex items-center justify-center size-8 rounded-lg bg-success/10 text-success">
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">สรุปผลตรวจรับ</h3>
                      <p className="text-xs text-muted-foreground">ภาพรวมการตรวจสอบ</p>
                    </div>
                  </div>
                  <div className="bg-muted rounded-lg p-3 text-sm">
                    <div className="flex gap-4">
                      <span>ทั้งหมด: <strong>{receivingUnits.length}</strong></span>
                      <span className="text-success">ผ่าน: <strong>{receivingUnits.filter((u) => u.status === 'PASS').length}</strong></span>
                      <span className="text-destructive">ไม่ผ่าน: <strong>{receivingUnits.filter((u) => u.status === 'REJECT').length}</strong></span>
                    </div>
                  </div>
                </div>
              )}

              {/* หมายเหตุ */}
              <div className="rounded-xl border border-border/50 bg-card p-5 shadow-sm">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.855z"/></svg>
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-foreground">หมายเหตุ</h3>
                    <p className="text-xs text-muted-foreground">บันทึกเพิ่มเติม</p>
                  </div>
                </div>
                <textarea
                  value={receivingNotes}
                  onChange={(e) => setReceivingNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden"
                  placeholder="บันทึกเพิ่มเติม..."
                />
              </div>
            </div>

            {/* Sticky Footer */}
            <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 flex justify-end gap-3 shrink-0">
              <button
                type="button"
                onClick={() => onClose()}
                className="px-4 py-2 text-sm text-muted-foreground"
              >
                ยกเลิก
              </button>
              <button
                type="submit"
                disabled={goodsReceivingMutation.isPending || receivingUnits.length === 0}
                className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {goodsReceivingMutation.isPending ? 'กำลังรับสินค้า...' : 'ยืนยันรับสินค้า'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
