import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../lib/api';
import AddressForm from './AddressForm';
import type { ShippingAddress } from '../../types/shipping';

interface Props {
  onNext: (addr: ShippingAddress) => void;
}

export default function AddressStep({ onNext }: Props) {
  const [adding, setAdding] = useState(false);
  const { data } = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api.get('/api/shop/me/addresses').then((r) => r.data as ShippingAddress[]),
  });
  const addresses = data ?? [];

  if (adding || addresses.length === 0) {
    return (
      <div className="space-y-4 leading-snug">
        <h2 className="text-xl font-bold">ที่อยู่จัดส่ง</h2>
        <AddressForm onSubmit={onNext} />
      </div>
    );
  }

  return (
    <div className="space-y-3 leading-snug">
      <h2 className="text-xl font-bold">เลือกที่อยู่จัดส่ง</h2>
      {addresses.map((a, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onNext(a)}
          className="w-full text-left rounded-xl border border-border p-4 hover:border-primary transition-colors"
        >
          <div className="font-semibold">
            {a.recipientName} · {a.phone}
          </div>
          <div className="text-sm text-muted-foreground">
            {a.line1} {a.line2} {a.subDistrict} {a.district} {a.province} {a.postalCode}
          </div>
        </button>
      ))}
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="text-primary text-sm underline-offset-4 hover:underline"
      >
        + เพิ่มที่อยู่ใหม่
      </button>
    </div>
  );
}
