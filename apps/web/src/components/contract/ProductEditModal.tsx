import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import ThaiDateInput from '@/components/ui/ThaiDateInput';

interface ProductData {
  id: string;
  name: string;
  brand: string;
  model: string;
  category: string;
  color: string | null;
  storage: string | null;
  serialNumber: string | null;
  imeiSerial: string | null;
  costPrice: string;
  batteryHealth: number | null;
  warrantyExpired: boolean | null;
  warrantyExpireDate: string | null;
  hasBox: boolean | null;
  accessoryType: string | null;
  accessoryBrand: string | null;
}

interface Props {
  product: ProductData;
  onClose: () => void;
  onSuccess: () => void;
}

export default function ProductEditModal({ product, onClose, onSuccess }: Props) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    name: product.name,
    brand: product.brand,
    model: product.model,
    color: product.color || '',
    storage: product.storage || '',
    imeiSerial: product.imeiSerial || '',
    serialNumber: product.serialNumber || '',
    costPrice: product.costPrice || '',
    batteryHealth: product.batteryHealth != null ? String(product.batteryHealth) : '',
    warrantyExpired: product.warrantyExpired ?? false,
    warrantyExpireDate: product.warrantyExpireDate ? product.warrantyExpireDate.split('T')[0] : '',
    hasBox: product.hasBox ?? false,
    accessoryType: product.accessoryType || '',
    accessoryBrand: product.accessoryBrand || '',
  });

  const mutation = useMutation({
    mutationFn: async (data: Record<string, unknown>) => {
      return api.patch(`/products/${product.id}`, data);
    },
    onSuccess: () => {
      toast.success('แก้ไขข้อมูลสินค้าสำเร็จ');
      onClose();
      onSuccess();
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-available'] });
    },
    onError: (err: unknown) => toast.error(getErrorMessage(err)),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      name: form.name,
      brand: form.brand,
      model: form.model,
      color: form.color || undefined,
      storage: form.storage || undefined,
      imeiSerial: form.imeiSerial || undefined,
      serialNumber: form.serialNumber || undefined,
      costPrice: form.costPrice !== '' ? parseFloat(form.costPrice) : undefined,
    };
    if (product.category === 'PHONE_USED') {
      payload.batteryHealth = form.batteryHealth ? Number(form.batteryHealth) : undefined;
      payload.warrantyExpired = form.warrantyExpired;
      payload.warrantyExpireDate = !form.warrantyExpired && form.warrantyExpireDate ? form.warrantyExpireDate : undefined;
      payload.hasBox = form.hasBox;
    }
    if (product.category === 'ACCESSORY') {
      payload.accessoryType = form.accessoryType || undefined;
      payload.accessoryBrand = form.accessoryBrand || undefined;
    }
    mutation.mutate(payload);
  };

  const inputClass = 'w-full h-10 px-3 rounded-lg border border-input bg-background text-sm transition-colors hover:border-primary/50 focus:border-primary focus:outline-hidden focus:ring-2 focus:ring-primary/20';
  const labelClass = 'block text-xs font-medium text-foreground mb-1.5';

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-8 pb-8" role="dialog" aria-modal="true" aria-label="แก้ไขข้อมูลสินค้า">
      <div className="w-full max-w-2xl bg-background rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[calc(100vh-4rem)]">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-xs border-b px-6 py-4 flex items-center justify-between shrink-0">
          <button type="button" onClick={onClose} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m15 18-6-6 6-6"/></svg>
            กลับ
          </button>
          <h2 className="text-lg font-semibold text-foreground">แก้ไขข้อมูลสินค้า</h2>
          <div className="w-16" />
        </div>
      <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto flex flex-col">
        <div className="p-6 space-y-5 flex-1">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10 text-primary">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20.91 8.84 8.56 2.23a1.93 1.93 0 0 0-1.81 0L3.1 4.13a2.12 2.12 0 0 0-.05 3.69l12.22 6.93a2 2 0 0 0 1.94 0L21 12.51a2.12 2.12 0 0 0-.09-3.67Z"/><path d="m3.09 8.84 12.35-6.61"/><path d="M6 19v-4"/></svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">ข้อมูลสินค้า</h3>
              <p className="text-xs text-muted-foreground">รายละเอียดพื้นฐานของสินค้า</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="col-span-2 md:col-span-3">
              <label className={labelClass}>ชื่อสินค้า <span className="text-destructive">*</span></label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputClass} required />
            </div>
            {product.category !== 'ACCESSORY' ? (
              <>
                <div>
                  <label className={labelClass}>ยี่ห้อ <span className="text-destructive">*</span></label>
                  <input type="text" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} className={inputClass} required />
                </div>
                <div>
                  <label className={labelClass}>รุ่น <span className="text-destructive">*</span></label>
                  <input type="text" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className={inputClass} required />
                </div>
                <div>
                  <label className={labelClass}>สี</label>
                  <input type="text" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>ความจุ</label>
                  <input type="text" value={form.storage} onChange={(e) => setForm({ ...form, storage: e.target.value })} className={inputClass} />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className={labelClass}>ประเภทอุปกรณ์</label>
                  <input type="text" value={form.accessoryType} onChange={(e) => setForm({ ...form, accessoryType: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className={labelClass}>ยี่ห้ออุปกรณ์</label>
                  <input type="text" value={form.accessoryBrand} onChange={(e) => setForm({ ...form, accessoryBrand: e.target.value })} className={inputClass} />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2.5 mb-4">
            <div className="flex items-center justify-center size-8 rounded-lg bg-success/10 text-success">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" x2="22" y1="10" y2="10"/></svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">หมายเลขเครื่อง & ราคา</h3>
              <p className="text-xs text-muted-foreground">IMEI, Serial Number, ราคาทุน</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>IMEI / Serial</label>
              <input type="text" value={form.imeiSerial} onChange={(e) => setForm({ ...form, imeiSerial: e.target.value })} className={`${inputClass} font-mono`} />
            </div>
            <div>
              <label className={labelClass}>Serial Number</label>
              <input type="text" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} className={`${inputClass} font-mono`} />
            </div>
            <div>
              <label className={labelClass}>ราคาทุน (บาท)</label>
              <input type="number" step="0.01" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} className={inputClass} />
            </div>
          </div>
        </div>

        {product.category === 'PHONE_USED' && (
          <div className="rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="flex items-center justify-center size-8 rounded-lg bg-warning/10 text-warning">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="16" height="20" x="4" y="2" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01"/><path d="M16 6h.01"/><path d="M12 6h.01"/></svg>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground">ข้อมูลมือสอง</h3>
                <p className="text-xs text-muted-foreground">แบตเตอรี่, ประกัน, กล่อง</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className={labelClass}>แบตเตอรี่ (%)</label>
                <input type="number" min="0" max="100" value={form.batteryHealth} onChange={(e) => setForm({ ...form, batteryHealth: e.target.value })} className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>วันหมดประกัน</label>
                <ThaiDateInput value={form.warrantyExpireDate} onChange={(e) => setForm({ ...form, warrantyExpireDate: e.target.value })} className={inputClass} disabled={form.warrantyExpired} />
              </div>
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input type="checkbox" checked={form.warrantyExpired} onChange={(e) => setForm({ ...form, warrantyExpired: e.target.checked })} className="rounded text-primary" />
                หมดประกันแล้ว
              </label>
              <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
                <input type="checkbox" checked={form.hasBox} onChange={(e) => setForm({ ...form, hasBox: e.target.checked })} className="rounded text-primary" />
                มีกล่อง
              </label>
            </div>
          </div>
        )}

        </div>
        <div className="sticky bottom-0 bg-background/95 backdrop-blur-xs border-t px-6 py-4 flex justify-end gap-3 shrink-0">
          <button type="button" onClick={onClose} className="px-6 py-2.5 text-sm border border-input rounded-lg hover:bg-muted transition-colors">ยกเลิก</button>
          <button type="submit" disabled={mutation.isPending} className="px-6 py-2.5 text-sm bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 font-semibold transition-colors shadow-sm">
            {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </form>
      </div>
    </div>
  );
}
