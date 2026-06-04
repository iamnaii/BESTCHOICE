import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import api from '@/lib/api';
import { ContactCombobox } from '@/components/contacts/ContactCombobox';

export interface CustomerStepValue {
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
}

export function CustomerPickerStep({
  value,
  onChange,
  onNext,
  presetCustomerId,
}: {
  value: CustomerStepValue;
  onChange: (v: CustomerStepValue) => void;
  onNext: () => void;
  presetCustomerId?: string;
}) {
  const [mode, setMode] = useState<'existing' | 'walkin'>('existing');

  // If preset → auto-fetch + lock
  const { data: presetCustomer } = useQuery({
    queryKey: ['customer', presetCustomerId],
    queryFn: async () => {
      const { data } = await api.get(`/customers/${presetCustomerId}`);
      return data;
    },
    enabled: !!presetCustomerId && !value.customerId,
  });

  useEffect(() => {
    if (presetCustomer && !value.customerId) {
      onChange({
        customerId: presetCustomer.id,
        customerName: presetCustomer.name,
        customerPhone: presetCustomer.phone ?? undefined,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presetCustomer]);

  const canProceed =
    !!value.customerId || (mode === 'walkin' && !!value.customerName && !!value.customerPhone);

  return (
    <Card className="p-6 space-y-4">
      <h3 className="font-medium">1. ลูกค้า</h3>

      {!presetCustomerId && (
        <div className="flex gap-2">
          <Button
            variant={mode === 'existing' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setMode('existing')}
          >
            ลูกค้าเก่า
          </Button>
          <Button
            variant={mode === 'walkin' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setMode('walkin')}
          >
            Walk-in (ลูกค้าใหม่)
          </Button>
        </div>
      )}

      {(presetCustomerId || mode === 'existing') && (
        <div className="space-y-2">
          {!value.customerId && !presetCustomerId && (
            <ContactCombobox
              roleNeeded="CUSTOMER"
              value={value.customerName ?? ''}
              placeholder="ค้นหาลูกค้า (ชื่อ/เบอร์/เลขภาษี)"
              onSelect={({ childId, name }) =>
                onChange({ customerId: childId, customerName: name, customerPhone: value.customerPhone })
              }
            />
          )}
          {value.customerId && (
            <div className="p-3 bg-muted/30 rounded-md">
              <p className="font-medium">{value.customerName}</p>
              {value.customerPhone && (
                <p className="text-sm text-muted-foreground">{value.customerPhone}</p>
              )}
              {!presetCustomerId && (
                <Button variant="ghost" size="sm" onClick={() => onChange({})} className="mt-2">
                  เปลี่ยน
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {!presetCustomerId && mode === 'walkin' && (
        <div className="space-y-3">
          <div>
            <Label>ชื่อ *</Label>
            <Input
              value={value.customerName ?? ''}
              onChange={(e) =>
                onChange({ ...value, customerName: e.target.value, customerId: undefined })
              }
            />
          </div>
          <div>
            <Label>เบอร์โทร *</Label>
            <Input
              type="tel"
              value={value.customerPhone ?? ''}
              onChange={(e) =>
                onChange({ ...value, customerPhone: e.target.value, customerId: undefined })
              }
            />
          </div>
        </div>
      )}

      <div className="flex justify-end">
        <Button onClick={onNext} disabled={!canProceed}>
          ถัดไป →
        </Button>
      </div>
    </Card>
  );
}

