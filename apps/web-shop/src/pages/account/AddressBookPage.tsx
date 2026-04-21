import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { api } from '../../lib/api';
import ShopLayout from '../../components/layout/ShopLayout';
import AddressForm from '../../components/checkout/AddressForm';
import type { ShippingAddress } from '../../types/shipping';

export default function AddressBookPage() {
  const qc = useQueryClient();
  const [adding, setAdding] = useState(false);
  const { data } = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api.get('/api/shop/me/addresses').then((r) => r.data as ShippingAddress[]),
  });
  const mut = useMutation({
    mutationFn: (addr: ShippingAddress) =>
      api.post('/api/shop/me/addresses', addr).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['addresses'] });
      setAdding(false);
      toast.success('บันทึกที่อยู่แล้ว');
    },
    onError: () => toast.error('บันทึกไม่สำเร็จ'),
  });
  return (
    <ShopLayout>
      <div className="container mx-auto px-4 py-6 space-y-4 max-w-2xl leading-snug">
        <h1 className="text-2xl font-bold">ที่อยู่จัดส่ง</h1>
        {(data ?? []).map((a, i) => (
          <div key={i} className="rounded-xl border border-border p-4">
            <div className="font-semibold">
              {a.recipientName} · {a.phone}
            </div>
            <div className="text-sm text-muted-foreground">
              {a.line1} {a.line2 ?? ''} {a.subDistrict} {a.district} {a.province} {a.postalCode}
            </div>
          </div>
        ))}
        {adding ? (
          <AddressForm onSubmit={(v) => mut.mutate(v)} />
        ) : (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="text-primary text-sm underline-offset-4 hover:underline"
          >
            + เพิ่มที่อยู่ใหม่
          </button>
        )}
      </div>
    </ShopLayout>
  );
}
