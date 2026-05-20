import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import api from '@/lib/api';

export interface DeviceStepValue {
  contractId?: string;
  productId?: string;
  deviceBrand?: string;
  deviceModel?: string;
  deviceImei?: string;
  deviceSerial?: string;
}

type Tab = 'contract' | 'product' | 'freetext';

interface ContractItem {
  id: string;
  contractNumber: string;
  product?: {
    id: string;
    brand?: string;
    model?: string;
    imeiSerial?: string;
  } | null;
}

export function DevicePickerStep({
  customerId,
  value,
  onChange,
  onNext,
  onBack,
  presetContractId,
  presetProductId,
}: {
  customerId?: string;
  value: DeviceStepValue;
  onChange: (v: DeviceStepValue) => void;
  onNext: () => void;
  onBack: () => void;
  presetContractId?: string;
  presetProductId?: string;
}) {
  const initialTab: Tab = presetContractId
    ? 'contract'
    : presetProductId
      ? 'product'
      : customerId
        ? 'contract'
        : 'freetext';
  const [tab, setTab] = useState<Tab>(initialTab);

  const { data: contracts } = useQuery({
    queryKey: ['customer-contracts', customerId],
    queryFn: async () => {
      if (!customerId) return [];
      const { data } = await api.get(
        `/contracts?customerId=${customerId}&status=ACTIVE&limit=20`,
      );
      return (data.data as ContractItem[]) || [];
    },
    enabled: !!customerId && tab === 'contract',
  });

  const canProceed =
    (tab === 'contract' && !!value.contractId) ||
    (tab === 'product' && !!value.productId) ||
    (tab === 'freetext' &&
      (!!value.deviceBrand || !!value.deviceImei || !!value.deviceSerial));

  return (
    <Card className="p-6 space-y-4">
      <h3 className="font-medium">2. เครื่อง</h3>

      <div className="flex gap-2 flex-wrap">
        {customerId && (
          <Button
            variant={tab === 'contract' ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setTab('contract')}
          >
            จากสัญญา
          </Button>
        )}
        {/* "เลือกจากสต็อก" tab is disabled until the real ProductPicker component is integrated.
            The raw UUID input ships broken UX — hide behind disabled until follow-up PR. */}
        <Button
          variant="outline"
          size="sm"
          disabled
          title="กำลังพัฒนา — ใช้ &quot;จากสัญญา&quot; หรือ &quot;กรอกข้อมูลเอง&quot;"
        >
          เลือกจากสต็อก
        </Button>
        <Button
          variant={tab === 'freetext' ? 'primary' : 'outline'}
          size="sm"
          onClick={() => setTab('freetext')}
        >
          กรอกข้อมูลเอง
        </Button>
      </div>

      {tab === 'contract' && customerId && (
        <div className="space-y-2">
          {contracts?.map((c) => (
            <Button
              key={c.id}
              variant={value.contractId === c.id ? 'primary' : 'outline'}
              className="w-full justify-start text-left h-auto py-2"
              onClick={() =>
                onChange({ contractId: c.id, productId: c.product?.id })
              }
            >
              <div>
                <div className="font-medium">{c.contractNumber}</div>
                {c.product && (
                  <div className="text-sm text-muted-foreground font-normal">
                    {c.product.brand} {c.product.model}
                    {c.product.imeiSerial && ` · IMEI ${c.product.imeiSerial}`}
                  </div>
                )}
              </div>
            </Button>
          ))}
          {contracts && contracts.length === 0 && (
            <p className="text-sm text-muted-foreground">
              ลูกค้ารายนี้ยังไม่มีสัญญาที่ ACTIVE
            </p>
          )}
        </div>
      )}

      {tab === 'product' && (
        /* This branch is unreachable while the tab button is disabled.
           Kept as a placeholder for when ProductPicker is integrated (follow-up PR). */
        <p className="text-sm text-muted-foreground">
          กำลังพัฒนา — ฟีเจอร์นี้จะเปิดใช้งานในเวอร์ชันถัดไป
        </p>
      )}

      {tab === 'freetext' && (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>ยี่ห้อ</Label>
            <Input
              value={value.deviceBrand ?? ''}
              onChange={(e) => onChange({ ...value, deviceBrand: e.target.value })}
            />
          </div>
          <div>
            <Label>รุ่น</Label>
            <Input
              value={value.deviceModel ?? ''}
              onChange={(e) => onChange({ ...value, deviceModel: e.target.value })}
            />
          </div>
          <div>
            <Label>IMEI</Label>
            <Input
              value={value.deviceImei ?? ''}
              onChange={(e) => onChange({ ...value, deviceImei: e.target.value })}
            />
          </div>
          <div>
            <Label>Serial</Label>
            <Input
              value={value.deviceSerial ?? ''}
              onChange={(e) => onChange({ ...value, deviceSerial: e.target.value })}
            />
          </div>
        </div>
      )}

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={onBack}>
          ← ย้อน
        </Button>
        <Button onClick={onNext} disabled={!canProceed}>
          ถัดไป →
        </Button>
      </div>
    </Card>
  );
}
