import Modal from '@/components/ui/Modal';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { ColorSelector, StorageSelector } from '@/components/product/VariantSelector';
import { categoryOptions } from '@/lib/constants';
import { productStatusMap } from '@/lib/status-badges';

interface EditForm {
  name: string;
  brand: string;
  model: string;
  color: string;
  storage: string;
  imeiSerial: string;
  serialNumber: string;
  category: string;
  costPrice: string;
  status: string;
  batteryHealth: string;
  warrantyExpired: boolean;
  warrantyExpireDate: string;
  hasBox: boolean;
  accessoryType: string;
  accessoryBrand: string;
  conditionGrade: string;
  shopWarrantyDays: string;
  accessoriesIncluded: string;
  cosmeticNotes: string;
}

interface EditProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  editForm: EditForm;
  setEditForm: React.Dispatch<React.SetStateAction<EditForm>>;
  onSubmit: (e: React.FormEvent) => void;
  isPending: boolean;
  /** สถานะจริงปัจจุบันของสินค้า (ไม่ใช่ค่าในฟอร์ม) — ใช้ตัดสินว่าแก้สถานะมือได้ไหม */
  currentStatus: string;
}

/**
 * สถานะที่ระบบตั้งผ่าน flow ขาย/จอง/ยึดเครื่อง — แก้มือจากหน้านี้ไม่ได้
 * ต้องตรงกับ SYSTEM_MANAGED_STATUSES ฝั่ง API (products/product-status.util.ts)
 * ซึ่งเป็นตัวบังคับจริง — ฝั่งนี้แค่ไม่โชว์ตัวเลือกที่ยังไงก็โดนปฏิเสธ
 */
const SYSTEM_MANAGED_STATUSES = new Set([
  'RESERVED',
  'SOLD_CASH',
  'SOLD_INSTALLMENT',
  'SOLD_RESELL',
  'REPOSSESSED',
]);

export default function EditProductModal({
  isOpen,
  onClose,
  editForm,
  setEditForm,
  onSubmit,
  isPending,
  currentStatus,
}: EditProductModalProps) {
  const statusLocked = SYSTEM_MANAGED_STATUSES.has(currentStatus);
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="แก้ไขข้อมูลสินค้า">
      <form onSubmit={onSubmit} className="space-y-4 max-h-[70vh] overflow-y-auto">
        <div>
          <label className="block text-xs font-medium text-foreground mb-1">ชื่อสินค้า</label>
          <input
            type="text"
            value={editForm.name}
            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm"
            required
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">ประเภท</label>
            <select
              value={editForm.category}
              onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm"
            >
              {categoryOptions.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">สถานะ</label>
            <select
              value={editForm.status}
              onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm disabled:opacity-60"
              disabled={statusLocked}
            >
              {Object.entries(productStatusMap)
                .filter(([val]) => val === currentStatus || !SYSTEM_MANAGED_STATUSES.has(val))
                .map(([val, s]) => (
                  <option key={val} value={val}>{s.label}</option>
                ))}
            </select>
            {statusLocked && (
              <p className="mt-1 text-xs text-muted-foreground leading-snug">
                สถานะนี้ระบบจัดการผ่านรายการขาย/จอง/ยึดเครื่อง — แก้ผ่าน flow นั้นแทน
              </p>
            )}
          </div>
        </div>

        {editForm.category !== 'ACCESSORY' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">ยี่ห้อ</label>
              <input
                type="text"
                value={editForm.brand}
                onChange={(e) => setEditForm({ ...editForm, brand: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">รุ่น</label>
              <input
                type="text"
                value={editForm.model}
                onChange={(e) => setEditForm({ ...editForm, model: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm"
                required
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">สี</label>
              <ColorSelector value={editForm.color} onChange={(v) => setEditForm({ ...editForm, color: v })} />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1.5">ความจุ</label>
              <StorageSelector value={editForm.storage} onChange={(v) => setEditForm({ ...editForm, storage: v })} />
            </div>
          </div>
        )}

        {editForm.category === 'ACCESSORY' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">ประเภทอุปกรณ์</label>
              <input
                type="text"
                value={editForm.accessoryType}
                onChange={(e) => setEditForm({ ...editForm, accessoryType: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">ยี่ห้ออุปกรณ์</label>
              <input
                type="text"
                value={editForm.accessoryBrand}
                onChange={(e) => setEditForm({ ...editForm, accessoryBrand: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm"
              />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">IMEI / Serial</label>
            <input
              type="text"
              value={editForm.imeiSerial}
              onChange={(e) => setEditForm({ ...editForm, imeiSerial: e.target.value })}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Serial Number</label>
            <input
              type="text"
              value={editForm.serialNumber}
              onChange={(e) => setEditForm({ ...editForm, serialNumber: e.target.value })}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm font-mono"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-foreground mb-1">ราคาทุน (บาท)</label>
          <input
            type="number"
            step="0.01"
            value={editForm.costPrice}
            onChange={(e) => setEditForm({ ...editForm, costPrice: e.target.value })}
            className="w-full px-3 py-2 border border-input rounded-lg text-sm"
            required
          />
        </div>

        {editForm.category === 'PHONE_USED' && (
          <div className="border-t pt-3 space-y-3">
            <div className="text-xs font-semibold text-muted-foreground">ข้อมูลมือสอง</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">แบตเตอรี่ (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={editForm.batteryHealth}
                  onChange={(e) => setEditForm({ ...editForm, batteryHealth: e.target.value })}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1">วันหมดประกัน</label>
                <ThaiDateInput
                  value={editForm.warrantyExpireDate}
                  onChange={(e) => setEditForm({ ...editForm, warrantyExpireDate: e.target.value })}
                  className="w-full px-3 py-2 border border-input rounded-lg text-sm"
                  disabled={editForm.warrantyExpired}
                />
              </div>
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.warrantyExpired}
                  onChange={(e) => setEditForm({ ...editForm, warrantyExpired: e.target.checked })}
                  className="rounded text-primary"
                />
                หมดประกันแล้ว
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={editForm.hasBox}
                  onChange={(e) => setEditForm({ ...editForm, hasBox: e.target.checked })}
                  className="rounded text-primary"
                />
                มีกล่อง
              </label>
            </div>
          </div>
        )}

        <div className="border-t pt-3 space-y-3">
          <div className="text-xs font-semibold text-muted-foreground">ข้อมูลสำหรับตอบลูกค้า</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">เกรดเครื่อง</label>
              <select
                value={editForm.conditionGrade}
                onChange={(e) => setEditForm({ ...editForm, conditionGrade: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm"
              >
                <option value="">ไม่ระบุ</option>
                <option value="A">เกรด A</option>
                <option value="B">เกรด B</option>
                <option value="C">เกรด C</option>
                <option value="D">เกรด D</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-foreground mb-1">ประกันร้าน (วัน)</label>
              <input
                type="number"
                min="0"
                step="1"
                value={editForm.shopWarrantyDays}
                onChange={(e) => setEditForm({ ...editForm, shopWarrantyDays: e.target.value })}
                className="w-full px-3 py-2 border border-input rounded-lg text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">
              อุปกรณ์ที่แถม (คั่นด้วยลูกน้ำ)
            </label>
            <input
              type="text"
              value={editForm.accessoriesIncluded}
              onChange={(e) => setEditForm({ ...editForm, accessoriesIncluded: e.target.value })}
              placeholder="สายชาร์จ, กล่อง, หัวชาร์จ"
              className="w-full px-3 py-2 border border-input rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">ตำหนิ (ไม่เกิน 500 ตัวอักษร)</label>
            <textarea
              value={editForm.cosmeticNotes}
              onChange={(e) => setEditForm({ ...editForm, cosmeticNotes: e.target.value })}
              maxLength={500}
              rows={2}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm leading-snug resize-none"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground">
            ยกเลิก
          </button>
          <button
            type="submit"
            disabled={isPending}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
