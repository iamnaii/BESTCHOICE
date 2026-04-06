import { UseMutationResult } from '@tanstack/react-query';
import Modal from '@/components/ui/Modal';
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
  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`รับสินค้า - ${selectedPO?.poNumber || ''}`}
      size="xl"
    >
      {selectedPO && (
        <form onSubmit={handleGoodsReceiving} className="space-y-4">
          <div className="bg-primary-50 border border-primary-200 rounded-lg p-3 text-sm text-primary-700">
            ตรวจรับสินค้าทีละชิ้น ระบุ IMEI/Serial ราคาขาย แล้วเลือกผลตรวจ (ผ่าน/ไม่ผ่าน)
            <br />
            สินค้าที่ผ่านจะเข้าสถานะ QC_PENDING รอยืนยันก่อนเข้าคลัง
          </div>

          <div className="space-y-3 max-h-[50vh] overflow-y-auto">
            {receivingUnits.map((unit, idx) => (
              <div key={idx} className={`border rounded-lg p-3 ${unit.status === 'REJECT' ? 'border-red-300 bg-red-50' : 'border-border'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium">{unit.label}</span>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => updateReceivingUnit(idx, 'status', 'PASS')}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                        unit.status === 'PASS'
                          ? 'bg-green-600 text-white'
                          : 'bg-muted text-muted-foreground hover:bg-green-100'
                      }`}
                    >
                      ผ่าน
                    </button>
                    <button
                      type="button"
                      onClick={() => updateReceivingUnit(idx, 'status', 'REJECT')}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                        unit.status === 'REJECT'
                          ? 'bg-red-600 text-white'
                          : 'bg-muted text-muted-foreground hover:bg-red-100'
                      }`}
                    >
                      ไม่ผ่าน
                    </button>
                  </div>
                </div>
                {unit.category !== 'ACCESSORY' && (
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    placeholder="IMEI"
                    value={unit.imeiSerial}
                    onChange={(e) => updateReceivingUnit(idx, 'imeiSerial', e.target.value)}
                    className="px-2 py-1.5 border border-input rounded text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none font-mono"
                  />
                  <input
                    type="text"
                    placeholder="Serial Number"
                    value={unit.serialNumber}
                    onChange={(e) => updateReceivingUnit(idx, 'serialNumber', e.target.value)}
                    className="px-2 py-1.5 border border-input rounded text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none font-mono"
                  />
                </div>
                )}
                {unit.category === 'PHONE_USED' && unit.status === 'PASS' && (
                  <div className="mt-2 border border-warning/20 bg-warning/5 dark:bg-warning/10 rounded-lg p-3 space-y-2">
                    <div className="text-xs font-medium text-orange-700 mb-1">ข้อมูลมือสอง</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="block text-xs text-muted-foreground mb-0.5">% แบตเตอรี่</label>
                        <input
                          type="number"
                          placeholder="เช่น 87"
                          value={unit.batteryHealth}
                          onChange={(e) => updateReceivingUnit(idx, 'batteryHealth', e.target.value)}
                          className="w-full px-2 py-1.5 border border-input rounded text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
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
                            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${unit.hasBox ? 'bg-green-600 text-white' : 'bg-muted text-muted-foreground hover:bg-green-100'}`}
                          >
                            มีกล่อง
                          </button>
                          <button
                            type="button"
                            onClick={() => updateReceivingUnit(idx, 'hasBox', 'false')}
                            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${!unit.hasBox ? 'bg-red-600 text-white' : 'bg-muted text-muted-foreground hover:bg-red-100'}`}
                          >
                            ไม่มีกล่อง
                          </button>
                        </div>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-0.5">ประกันศูนย์</label>
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
                            className="flex-1 px-2 py-1.5 border border-input rounded text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
                          />
                        )}
                      </div>
                    </div>

                    {/* Checklist */}
                    <div className="mt-2 border-t border-orange-200 pt-2">
                      <div className="text-xs font-medium text-orange-700 mb-2">เช็คลิสต์ตรวจเครื่อง</div>
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
                                      ? 'bg-green-500 text-white'
                                      : 'bg-red-500 text-white'
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
                                    className="w-32 px-1.5 py-0.5 border border-red-300 rounded text-xs focus-visible:ring-1 focus-visible:ring-ring/30 outline-none"
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
                      <label className="block text-xs text-muted-foreground mb-0.5">ราคาขาย (บาท)</label>
                      <input
                        type="number"
                        placeholder="เช่น 15000"
                        value={unit.sellingPrice}
                        onChange={(e) => updateReceivingUnit(idx, 'sellingPrice', e.target.value)}
                        className="w-full px-2 py-1.5 border border-input rounded text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
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
                    className="mt-2 w-full px-2 py-1.5 border border-red-300 rounded text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
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

          {receivingUnits.length > 0 && (
            <div className="bg-muted rounded-lg p-3 text-sm">
              <div className="flex gap-4">
                <span>ทั้งหมด: <strong>{receivingUnits.length}</strong></span>
                <span className="text-success">ผ่าน: <strong>{receivingUnits.filter((u) => u.status === 'PASS').length}</strong></span>
                <span className="text-destructive">ไม่ผ่าน: <strong>{receivingUnits.filter((u) => u.status === 'REJECT').length}</strong></span>
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">หมายเหตุ</label>
            <textarea
              value={receivingNotes}
              onChange={(e) => setReceivingNotes(e.target.value)}
              rows={2}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-none"
              placeholder="บันทึกเพิ่มเติม..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t">
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
    </Modal>
  );
}
