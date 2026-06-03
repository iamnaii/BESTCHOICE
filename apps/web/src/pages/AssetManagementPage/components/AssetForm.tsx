import { useState } from 'react';
import {
  Package,
  Tag,
  Calculator,
  Settings,
  ChevronDown,
  ChevronUp,
  ArrowLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Asset, Branch, categoryOptions, inputClass, fmt, AssetForm as AssetFormType } from '../types';
import { useCoaGroups } from '@/hooks/useCoa';
import { accountDisplayName } from '@/utils/accountName';

interface AssetFormProps {
  editingAsset: Asset | null;
  form: AssetFormType;
  branches: Branch[] | undefined;
  isPending: boolean;
  onClose: () => void;
  onSubmit: (e: React.FormEvent) => void;
  setField: (field: string, value: string | number | boolean) => void;
}

export default function AssetForm({
  editingAsset,
  form,
  branches,
  isPending,
  onClose,
  onSubmit,
  setField,
}: AssetFormProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  const { data: assetCoa } = useCoaGroups({ codePrefix: '12-21' });
  const { data: depCoa } = useCoaGroups({ codePrefix: '53-16' });

  const allAssets = assetCoa?.groups.flatMap((g) => g.accounts) ?? [];
  const costAccounts = allAssets.filter((a) => a.normalBalance === 'Dr');
  const accumAccounts = allAssets.filter((a) => a.normalBalance === 'Cr');
  const depAccounts = depCoa?.groups.flatMap((g) => g.accounts) ?? [];

  return (
    <div className="fixed inset-0 z-50 bg-foreground/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8">
      <div className="w-full max-w-4xl bg-background rounded-xl shadow-2xl overflow-y-auto max-h-[calc(100vh-4rem)]">
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="size-4" /> กลับ
          </button>
          <h2 className="text-lg font-semibold text-foreground">
            {editingAsset ? 'แก้ไขสินทรัพย์' : 'เพิ่มสินทรัพย์ใหม่'}
          </h2>
          <div className="w-16" />
        </div>

        <form id="asset-form" onSubmit={onSubmit} className="p-6 space-y-5">
          {/* Section 1: ข้อมูลสินทรัพย์ */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
                <Package className="size-4" strokeWidth={1.5} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ข้อมูลสินทรัพย์</h3>
                <p className="text-xs text-muted-foreground">รหัส, ชื่อ, รายละเอียด</p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    รหัสสินทรัพย์ <span className="text-destructive">*</span>
                  </label>
                  <div className="flex gap-2">
                    <input
                      className={`${inputClass} flex-1`}
                      value={form.assetCode}
                      onChange={(e) => setField('assetCode', e.target.value)}
                      placeholder="เช่น FA-001"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setField('assetCode', `FA-${String(Date.now()).slice(-6)}`)}
                      className="px-3 py-2 text-xs font-medium bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors whitespace-nowrap"
                    >
                      สร้างอัตโนมัติ
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    ชื่อสินทรัพย์ <span className="text-destructive">*</span>
                  </label>
                  <input
                    className={inputClass}
                    value={form.name}
                    onChange={(e) => setField('name', e.target.value)}
                    placeholder="ชื่อสินทรัพย์"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">รายละเอียด</label>
                <textarea
                  className={`${inputClass} resize-none`}
                  value={form.description}
                  onChange={(e) => setField('description', e.target.value)}
                  placeholder="รายละเอียดเพิ่มเติม (ถ้ามี)"
                  rows={2}
                />
              </div>
            </div>
          </div>

          {/* Section 2: การจัดหมวดหมู่ */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-warning/10 text-warning">
                <Tag className="size-4" strokeWidth={1.5} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">การจัดหมวดหมู่</h3>
                <p className="text-xs text-muted-foreground">หมวดหมู่, สาขา</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">หมวดหมู่</label>
                <select
                  className={inputClass}
                  value={form.category}
                  onChange={(e) => setField('category', e.target.value)}
                >
                  {categoryOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-foreground mb-1.5">สาขา</label>
                <select
                  className={inputClass}
                  value={form.branchId}
                  onChange={(e) => setField('branchId', e.target.value)}
                >
                  <option value="">-- เลือกสาขา --</option>
                  {(branches ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Section 3: ข้อมูลทางการเงิน */}
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-success/10 text-success">
                <Calculator className="size-4" strokeWidth={1.5} />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ข้อมูลทางการเงิน</h3>
                <p className="text-xs text-muted-foreground">ราคาทุน, มูลค่าซาก, อายุใช้งาน</p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    ราคาทุน (บาท) <span className="text-destructive">*</span>
                  </label>
                  <input
                    type="number"
                    className={inputClass}
                    value={form.costValue}
                    onChange={(e) => setField('costValue', e.target.value)}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    มูลค่าซาก (บาท)
                  </label>
                  <input
                    type="number"
                    className={inputClass}
                    value={form.salvageValue}
                    onChange={(e) => setField('salvageValue', e.target.value)}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    อายุใช้งาน (ปี)
                  </label>
                  <input
                    type="number"
                    className={inputClass}
                    value={form.usefulLife}
                    onChange={(e) => setField('usefulLife', e.target.value)}
                    placeholder="5"
                    min="1"
                  />
                </div>
              </div>
              <div className="max-w-xs">
                <label className="block text-xs font-medium text-foreground mb-1.5">วันที่ซื้อ</label>
                <ThaiDateInput
                  value={form.purchaseDate}
                  onChange={(e) => setField('purchaseDate', e.target.value)}
                  className={inputClass}
                />
              </div>

              {/* Live depreciation summary */}
              {Number(form.costValue) > 0 && Number(form.usefulLife) > 0 && (
                <div className="bg-linear-to-br from-success/5 to-success/10 dark:from-success/10 dark:to-success/15 rounded-xl p-4 space-y-2 text-sm border border-success/15">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">ราคาทุน</span>
                    <span className="font-medium">{fmt(form.costValue)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">มูลค่าซาก</span>
                    <span className="font-medium">{fmt(form.salvageValue || '0')}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">มูลค่าเสื่อมราคาได้</span>
                    <span className="font-medium">
                      {fmt(Number(form.costValue) - Number(form.salvageValue || 0))}
                    </span>
                  </div>
                  <div className="border-t border-success/20 pt-2.5 mt-1 space-y-1.5">
                    <div className="flex justify-between font-bold">
                      <span className="text-success">ค่าเสื่อมราคาต่อปี</span>
                      <span className="text-success">
                        {fmt(
                          (Number(form.costValue) - Number(form.salvageValue || 0)) /
                            Number(form.usefulLife),
                        )}
                      </span>
                    </div>
                    <div className="flex justify-between font-bold text-lg">
                      <span className="text-success">
                        ค่าเสื่อมราคาต่อเดือน
                      </span>
                      <span className="text-success">
                        {fmt(
                          (Number(form.costValue) - Number(form.salvageValue || 0)) /
                            Number(form.usefulLife) /
                            12,
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Section 4: รหัสบัญชี (ขั้นสูง) — collapsible */}
          <div className="rounded-xl border border-border bg-card p-5">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2.5 w-full text-left"
            >
              <div className="flex items-center justify-center size-8 rounded-lg bg-muted text-muted-foreground">
                <Settings className="size-4" strokeWidth={1.5} />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-foreground">รหัสบัญชี (ขั้นสูง)</h3>
                <p className="text-xs text-muted-foreground">
                  รหัสบัญชีสินทรัพย์, ค่าเสื่อม, ค่าเสื่อมสะสม
                </p>
              </div>
              {showAdvanced ? (
                <ChevronUp className="size-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="size-4 text-muted-foreground" />
              )}
            </button>
            {showAdvanced && (
              <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-border">
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    รหัสบัญชีสินทรัพย์
                  </label>
                  <select
                    className={inputClass}
                    value={form.assetAccountCode}
                    onChange={(e) => setField('assetAccountCode', e.target.value)}
                  >
                    <option value="">-- เลือก --</option>
                    {costAccounts.map((a) => (
                      <option key={a.code} value={a.code}>
                        {accountDisplayName(a.name)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    รหัสบัญชีค่าเสื่อม
                  </label>
                  <select
                    className={inputClass}
                    value={form.depreciationAccountCode}
                    onChange={(e) => setField('depreciationAccountCode', e.target.value)}
                  >
                    <option value="">-- เลือก --</option>
                    {depAccounts.map((a) => (
                      <option key={a.code} value={a.code}>
                        {accountDisplayName(a.name)}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1.5">
                    รหัสบัญชีค่าเสื่อมสะสม
                  </label>
                  <select
                    className={inputClass}
                    value={form.accumulatedDepreAccountCode}
                    onChange={(e) => setField('accumulatedDepreAccountCode', e.target.value)}
                  >
                    <option value="">-- เลือก --</option>
                    {accumAccounts.map((a) => (
                      <option key={a.code} value={a.code}>
                        {accountDisplayName(a.name)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </form>

        {/* Sticky Footer Buttons */}
        <div className="sticky bottom-0 bg-background border-t border-border px-6 py-4 flex items-center justify-end gap-3">
          <Button variant="ghost" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button type="submit" form="asset-form" disabled={isPending}>
            {isPending
              ? 'กำลังบันทึก...'
              : editingAsset
                ? 'บันทึกการแก้ไข'
                : 'เพิ่มสินทรัพย์'}
          </Button>
        </div>
      </div>
    </div>
  );
}
