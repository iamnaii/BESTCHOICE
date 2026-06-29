import { ReceivingUnitForm, DefectReasonValue } from '../types';
import { checklistCategories, defectReasonOptions } from '../constants';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Camera, X, AlertTriangle } from 'lucide-react';

export interface ReceivingUnitCardProps {
  unit: ReceivingUnitForm;
  idx: number;
  isDuplicate: boolean;
  showCostPrice?: boolean; // direct-receive only
  updateReceivingUnit: (idx: number, field: string, value: string) => void;
  updateChecklist: (
    unitIdx: number,
    checkIdx: number,
    field: 'passed' | 'note',
    value: boolean | string,
  ) => void;
  onAddPhotos: (idx: number, files: FileList) => void;
  onRemovePhoto: (idx: number, photoIdx: number) => void;
}

// 44px-min touch targets per .claude/rules (mobile). Tokens only — no gray/hex/bg-white.
const segBtn = 'min-h-11 px-4 rounded-lg text-sm font-medium transition-colors';
const fieldInput =
  'w-full min-h-11 px-3 py-2 border border-input rounded-lg text-sm focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-[3px] focus-visible:ring-offset-background outline-hidden';

export function ReceivingUnitCard({
  unit,
  idx,
  isDuplicate,
  showCostPrice,
  updateReceivingUnit,
  updateChecklist,
  onAddPhotos,
  onRemovePhoto,
}: ReceivingUnitCardProps) {
  const isUsed = unit.category === 'PHONE_USED';
  const isAccessory = unit.category === 'ACCESSORY';
  return (
    <div
      className={`border rounded-xl p-3 leading-snug ${unit.status === 'REJECT' ? 'border-destructive/30 bg-destructive/5' : isDuplicate ? 'border-warning/50 bg-warning/5' : 'border-border bg-card'}`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-sm font-medium leading-snug">{unit.label}</span>
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => updateReceivingUnit(idx, 'status', 'PASS')}
            className={`${segBtn} ${unit.status === 'PASS' ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground hover:bg-success/10'}`}
          >
            ผ่าน
          </button>
          <button
            type="button"
            onClick={() => updateReceivingUnit(idx, 'status', 'REJECT')}
            className={`${segBtn} ${unit.status === 'REJECT' ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground hover:bg-destructive/10'}`}
          >
            ไม่ผ่าน
          </button>
        </div>
      </div>

      {showCostPrice && unit.status === 'PASS' && (
        <div className="mb-2">
          <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">
            ราคาทุน (บาท) <span className="text-destructive">*</span>
          </label>
          <input
            type="number"
            min="0"
            inputMode="decimal"
            value={unit.costPrice}
            onChange={(e) => updateReceivingUnit(idx, 'costPrice', e.target.value)}
            required
            className={fieldInput}
            placeholder="เช่น 30000"
          />
        </div>
      )}

      {!isAccessory && unit.status === 'PASS' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">
              IMEI <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={unit.imeiSerial}
              onChange={(e) => updateReceivingUnit(idx, 'imeiSerial', e.target.value)}
              required
              className={`${fieldInput} font-mono ${isDuplicate ? 'border-warning' : ''}`}
              placeholder="IMEI"
            />
            {isDuplicate && (
              <p className="mt-1 flex items-center gap-1 text-xs text-warning leading-snug">
                <AlertTriangle className="size-3.5 shrink-0" /> IMEI ซ้ำกับเครื่องอื่นในรายการนี้
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">
              หมายเลขซีเรียล <span className="text-destructive">*</span>
            </label>
            <input
              type="text"
              value={unit.serialNumber}
              onChange={(e) => updateReceivingUnit(idx, 'serialNumber', e.target.value)}
              required
              className={`${fieldInput} font-mono`}
              placeholder="หมายเลขซีเรียล"
            />
          </div>
        </div>
      )}

      {/* Camera photo capture (mobile rear camera via capture attr) */}
      {unit.status === 'PASS' && (
        <div className="mt-2">
          <label className="block text-xs text-muted-foreground mb-1 leading-snug">
            รูปถ่ายเครื่อง
          </label>
          <div className="flex flex-wrap gap-2">
            {unit.photos.map((p, pIdx) => (
              <div key={pIdx} className="relative size-16 rounded-lg overflow-hidden border">
                <img src={p} alt={`รูป ${pIdx + 1}`} className="size-full object-cover" />
                <button
                  type="button"
                  onClick={() => onRemovePhoto(idx, pIdx)}
                  className="absolute top-0.5 right-0.5 size-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
            <label className="size-16 border-2 border-dashed border-input rounded-lg flex flex-col items-center justify-center cursor-pointer hover:border-primary/60 hover:bg-primary/5 transition-colors">
              <Camera className="size-5 text-muted-foreground" />
              <span className="text-[10px] text-muted-foreground leading-snug">ถ่ายรูป</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) onAddPhotos(idx, e.target.files);
                  e.target.value = '';
                }}
              />
            </label>
          </div>
        </div>
      )}

      {isUsed && unit.status === 'PASS' && (
        <div className="mt-2 border border-warning/20 bg-warning/5 dark:bg-warning/10 rounded-xl p-3 space-y-2">
          <div className="text-xs font-medium text-warning mb-1 leading-snug">ข้อมูลมือสอง</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">
                % แบตเตอรี่ <span className="text-destructive">*</span>
              </label>
              <input
                type="number"
                inputMode="numeric"
                min="0"
                max="100"
                value={unit.batteryHealth}
                onChange={(e) => updateReceivingUnit(idx, 'batteryHealth', e.target.value)}
                required
                className={fieldInput}
                placeholder="เช่น 87"
              />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">
                กล่อง
              </label>
              <div className="flex gap-2 mt-1">
                <button
                  type="button"
                  onClick={() => updateReceivingUnit(idx, 'hasBox', 'true')}
                  className={`${segBtn} ${unit.hasBox ? 'bg-success text-success-foreground' : 'bg-muted text-muted-foreground hover:bg-success/10'}`}
                >
                  มีกล่อง
                </button>
                <button
                  type="button"
                  onClick={() => updateReceivingUnit(idx, 'hasBox', 'false')}
                  className={`${segBtn} ${!unit.hasBox ? 'bg-destructive text-destructive-foreground' : 'bg-muted text-muted-foreground hover:bg-destructive/10'}`}
                >
                  ไม่มีกล่อง
                </button>
              </div>
            </div>
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">
              ประกันศูนย์ <span className="text-destructive">*</span>
            </label>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer min-h-11">
                <input
                  type="checkbox"
                  checked={unit.warrantyExpired}
                  onChange={(e) =>
                    updateReceivingUnit(idx, 'warrantyExpired', e.target.checked ? 'true' : 'false')
                  }
                  className="rounded size-4"
                />
                <span className="text-xs text-muted-foreground leading-snug">หมดประกันแล้ว</span>
              </label>
              {!unit.warrantyExpired && (
                <ThaiDateInput
                  value={unit.warrantyExpireDate}
                  onChange={(e) => updateReceivingUnit(idx, 'warrantyExpireDate', e.target.value)}
                  required
                  className={`flex-1 ${fieldInput}`}
                />
              )}
            </div>
          </div>
          <div className="mt-2 border-t border-warning/20 pt-2">
            <div className="text-xs font-medium text-warning mb-2 leading-snug">
              เช็คลิสต์ตรวจเครื่อง
            </div>
            {checklistCategories.map((cat) => (
              <div key={cat} className="mb-2">
                <div className="text-xs font-medium text-muted-foreground mb-1 leading-snug">
                  {cat}
                </div>
                <div className="space-y-1">
                  {unit.checklist.map((c, checkIdx) =>
                    c.category !== cat ? null : (
                      <div key={checkIdx} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => updateChecklist(idx, checkIdx, 'passed', !c.passed)}
                          className={`size-6 rounded flex items-center justify-center text-xs font-bold transition-colors ${c.passed ? 'bg-success text-success-foreground' : 'bg-destructive text-destructive-foreground'}`}
                        >
                          {c.passed ? '✓' : '✗'}
                        </button>
                        <span
                          className={`text-xs flex-1 leading-snug ${c.passed ? 'text-foreground' : 'text-destructive font-medium'}`}
                        >
                          {c.item}
                        </span>
                        {!c.passed && (
                          <input
                            type="text"
                            placeholder="หมายเหตุ"
                            value={c.note}
                            onChange={(e) => updateChecklist(idx, checkIdx, 'note', e.target.value)}
                            className="w-28 px-2 py-1.5 border border-destructive/30 rounded text-xs focus-visible:ring-1 focus-visible:ring-ring/30 outline-hidden"
                          />
                        )}
                      </div>
                    ),
                  )}
                </div>
              </div>
            ))}
            <div className="text-xs text-muted-foreground mt-1 leading-snug">
              ผ่าน {unit.checklist.filter((c) => c.passed).length}/{unit.checklist.length} รายการ
            </div>
          </div>
        </div>
      )}

      {unit.status === 'PASS' && (
        <div className="mt-2 border border-primary/20 bg-primary/5 dark:bg-primary/10 rounded-xl p-3">
          <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">
            ราคาขาย (บาท) <span className="text-destructive">*</span>
          </label>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            value={unit.sellingPrice}
            onChange={(e) => updateReceivingUnit(idx, 'sellingPrice', e.target.value)}
            required
            className={fieldInput}
            placeholder="เช่น 15000"
          />
        </div>
      )}

      {unit.status === 'REJECT' && (
        <div className="mt-2 space-y-2">
          <div>
            <label className="block text-xs text-muted-foreground mb-0.5 leading-snug">
              สาเหตุที่ไม่ผ่าน <span className="text-destructive">*</span>
            </label>
            <select
              value={unit.defectReason}
              onChange={(e) =>
                updateReceivingUnit(idx, 'defectReason', e.target.value as DefectReasonValue)
              }
              required
              className={fieldInput}
            >
              <option value="">เลือกสาเหตุ…</option>
              {defectReasonOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <input
            type="text"
            placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)"
            value={unit.rejectReason}
            onChange={(e) => updateReceivingUnit(idx, 'rejectReason', e.target.value)}
            className={fieldInput}
          />
        </div>
      )}
    </div>
  );
}
