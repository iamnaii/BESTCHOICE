import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import api, { getErrorMessage } from '@/lib/api';
import Modal from '@/components/ui/Modal';
import { toast } from 'sonner';

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

  return (
    <Modal isOpen title="แก้ไขข้อมูลสินค้า" onClose={onClose} size="lg">
      <form onSubmit={handleSubmit} className="space-y-5 max-h-[75vh] overflow-y-auto pr-1">
        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">ข้อมูลสินค้า</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="col-span-2 md:col-span-3">
              <label className="block text-xs text-muted-foreground mb-1">ชื่อสินค้า *</label>
              <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" required />
            </div>
            {product.category !== 'ACCESSORY' ? (
              <>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">ยี่ห้อ *</label>
                  <input type="text" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" required />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">รุ่น *</label>
                  <input type="text" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" required />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">สี</label>
                  <input type="text" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">ความจุ</label>
                  <input type="text" value={form.storage} onChange={(e) => setForm({ ...form, storage: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">ประเภทอุปกรณ์</label>
                  <input type="text" value={form.accessoryType} onChange={(e) => setForm({ ...form, accessoryType: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-muted-foreground mb-1">ยี่ห้ออุปกรณ์</label>
                  <input type="text" value={form.accessoryBrand} onChange={(e) => setForm({ ...form, accessoryBrand: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
                </div>
              </>
            )}
          </div>
        </div>

        <div className="border border-border rounded-lg p-4">
          <h3 className="text-sm font-semibold text-foreground mb-3">หมายเลขเครื่อง & ราคา</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">IMEI / Serial</label>
              <input type="text" value={form.imeiSerial} onChange={(e) => setForm({ ...form, imeiSerial: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Serial Number</label>
              <input type="text" value={form.serialNumber} onChange={(e) => setForm({ ...form, serialNumber: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm font-mono" />
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">ราคาทุน (บาท)</label>
              <input type="number" step="0.01" value={form.costPrice} onChange={(e) => setForm({ ...form, costPrice: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
            </div>
          </div>
        </div>

        {product.category === 'PHONE_USED' && (
          <div className="border border-border rounded-lg p-4">
            <h3 className="text-sm font-semibold text-foreground mb-3">ข้อมูลมือสอง</h3>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs text-muted-foreground mb-1">แบตเตอรี่ (%)</label>
                <input type="number" min="0" max="100" value={form.batteryHealth} onChange={(e) => setForm({ ...form, batteryHealth: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs text-muted-foreground mb-1">วันหมดประกัน</label>
                <input type="date" value={form.warrantyExpireDate} onChange={(e) => setForm({ ...form, warrantyExpireDate: e.target.value })} className="w-full px-3 py-2 border border-input rounded-lg text-sm" disabled={form.warrantyExpired} />
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

        <div className="flex justify-end gap-3 pt-2 sticky bottom-0 bg-background py-3 border-t">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-muted-foreground border border-input rounded-lg">ยกเลิก</button>
          <button type="submit" disabled={mutation.isPending} className="px-6 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50">
            {mutation.isPending ? 'กำลังบันทึก...' : 'บันทึก'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
