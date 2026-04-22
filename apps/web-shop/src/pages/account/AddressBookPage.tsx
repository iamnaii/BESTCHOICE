import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { MapPin, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import ShopLayout from '@/components/layout/ShopLayout';
import AddressForm from '@/components/checkout/AddressForm';
import {
  Button,
  Card,
  CardBody,
  CategoryHero,
  Container,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  StatefulList,
} from '@/components';
import type { ShippingAddress } from '@/types/shipping';

export default function AddressBookPage() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['addresses'],
    queryFn: () => api.get('/api/shop/me/addresses').then((r) => r.data as ShippingAddress[]),
  });
  const mut = useMutation({
    mutationFn: (addr: ShippingAddress) =>
      api.post('/api/shop/me/addresses', addr).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['addresses'] });
      setOpen(false);
      toast.success('บันทึกที่อยู่แล้ว');
    },
    onError: () => toast.error('บันทึกไม่สำเร็จ'),
  });

  return (
    <ShopLayout>
      <CategoryHero
        title="ที่อยู่ของฉัน"
        breadcrumbs={[{ label: 'บัญชี', to: '/account' }, { label: 'ที่อยู่' }]}
      />
      <Container>
        <div className="py-6 md:py-8 space-y-6 leading-snug">
          <StatefulList<ShippingAddress>
            isLoading={isLoading}
            isError={isError}
            data={data}
            onRetry={() => refetch()}
            loadingVariant="list"
            emptyState={{
              icon: <MapPin />,
              title: 'ยังไม่มีที่อยู่',
              description: 'เพิ่มที่อยู่จัดส่งเพื่อใช้สั่งซื้อสินค้าและรับเครื่องที่บ้าน',
            }}
            wrapperClassName="space-y-3"
            renderItem={(a, i) => (
              <Card key={i} variant="outlined">
                <CardBody>
                  <div className="space-y-1 leading-snug">
                    <div className="font-semibold text-foreground">
                      {a.recipientName} · {a.phone}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {a.line1} {a.line2 ?? ''} {a.subDistrict} {a.district} {a.province}{' '}
                      {a.postalCode}
                    </div>
                  </div>
                </CardBody>
              </Card>
            )}
          />

          <div>
            <Button
              variant="primary"
              size="lg"
              onClick={() => setOpen(true)}
              aria-label="เพิ่มที่อยู่"
            >
              <Plus className="size-4" />
              เพิ่มที่อยู่
            </Button>
          </div>
        </div>
      </Container>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เพิ่มที่อยู่ใหม่</DialogTitle>
          </DialogHeader>
          <AddressForm onSubmit={(v) => mut.mutate(v)} />
        </DialogContent>
      </Dialog>
    </ShopLayout>
  );
}
