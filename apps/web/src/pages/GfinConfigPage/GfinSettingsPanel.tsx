import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

/** shape ของ GET /gfin-config/settings */
export interface GfinSettingsApi {
  minDownPct: number;
  maxDownPct: number;
  downStepPct: number;
  contractFee: number;
  commissionPctByCategory: { PHONE: number; TABLET: number };
}

export const GFIN_SETTINGS_QUERY_KEY = ['gfin-settings'] as const;

type FormState = {
  minDownPct: string;
  commissionPhone: string;
  commissionTablet: string;
  contractFee: string;
};

const FIELDS: Array<{ key: keyof FormState; label: string; hint: string; step?: string }> = [
  {
    key: 'minDownPct',
    label: 'ดาวน์ขั้นต่ำที่ GFIN ตั้งให้ร้าน (%)',
    hint: 'dropdown ดาวน์ในหน้าสินค้าเริ่มจากค่านี้ ขั้นละ 5% ถึง 80%',
  },
  {
    key: 'commissionPhone',
    label: 'คอมมิชชั่นตั้งต้น มือถือ (%)',
    hint: 'ใช้เลือกเรทของ GFIN สำหรับมือถือใหม่และมือสอง (ผู้จัดการแก้รายเครื่องได้)',
  },
  {
    key: 'commissionTablet',
    label: 'คอมมิชชั่นตั้งต้น iPad (%)',
    hint: 'ใช้เลือกเรทของ GFIN สำหรับแท็บเล็ต',
  },
  {
    key: 'contractFee',
    label: 'ค่าทำสัญญา (฿)',
    hint: 'GFIN หักจากยอดโอนให้ร้าน (ยอดโอน = ยอดจัด + คอม − ค่าทำสัญญา)',
    step: '0.01',
  },
];

function toForm(s: GfinSettingsApi): FormState {
  return {
    minDownPct: String(s.minDownPct),
    commissionPhone: String(s.commissionPctByCategory.PHONE),
    commissionTablet: String(s.commissionPctByCategory.TABLET),
    contractFee: String(s.contractFee),
  };
}

/**
 * ค่าตั้งต้น GFIN นอกตารางราคา/เรท (system_config `gfin.*`) — OWNER แก้ได้ role อื่นดูอย่างเดียว
 * ค่าที่พิมพ์ค้างไว้ (edits) ทับค่าจาก API ทีละช่อง จนกดบันทึก
 */
export function GfinSettingsPanel() {
  const { user } = useAuth();
  const canEdit = user?.role === 'OWNER';
  const qc = useQueryClient();
  const [edits, setEdits] = useState<Partial<FormState>>({});

  const { data, isLoading, error } = useQuery<GfinSettingsApi>({
    queryKey: GFIN_SETTINGS_QUERY_KEY,
    queryFn: async () => {
      const { data: rows } = await api.get<GfinSettingsApi>('/gfin-config/settings');
      return rows;
    },
  });

  const save = useMutation({
    mutationFn: (payload: {
      minDownPct: number;
      commissionPhone: number;
      commissionTablet: number;
      contractFee: number;
    }) => api.patch('/gfin-config/settings', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: GFIN_SETTINGS_QUERY_KEY });
      setEdits({});
      toast.success('บันทึกค่าตั้งต้น GFIN แล้ว');
    },
    onError: () => toast.error('บันทึกไม่สำเร็จ'),
  });

  if (isLoading) return <div className="p-4 text-muted-foreground leading-snug">กำลังโหลด...</div>;
  if (error || !data)
    return <div className="p-4 text-destructive leading-snug">เกิดข้อผิดพลาด — โปรดลองรีเฟรช</div>;

  const form: FormState = { ...toForm(data), ...edits };

  const handleSave = () => {
    const payload = {
      minDownPct: Number(form.minDownPct),
      commissionPhone: Number(form.commissionPhone),
      commissionTablet: Number(form.commissionTablet),
      contractFee: Number(form.contractFee),
    };
    if (Object.values(payload).some((v) => !Number.isFinite(v) || v < 0)) {
      toast.error('กรอกตัวเลขให้ครบทุกช่อง');
      return;
    }
    save.mutate(payload);
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-snug">
        ค่าที่หน้าคำนวณสินเชื่อของ GFIN ใช้ นอกเหนือจากตารางราคาและเรท — ดาวน์เลือกได้ขั้นละ{' '}
        {data.downStepPct}% ถึง {data.maxDownPct}%
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label htmlFor={`gfin-setting-${f.key}`} className="text-sm font-medium leading-snug">
              {f.label}
            </label>
            <Input
              id={`gfin-setting-${f.key}`}
              type="number"
              min="0"
              step={f.step ?? '1'}
              value={form[f.key]}
              disabled={!canEdit}
              onChange={(e) => setEdits((prev) => ({ ...prev, [f.key]: e.target.value }))}
            />
            <p className="mt-1 text-xs text-muted-foreground leading-snug">{f.hint}</p>
          </div>
        ))}
      </div>
      {canEdit && (
        <Button variant="primary" onClick={handleSave} disabled={save.isPending}>
          บันทึกค่าตั้งต้น
        </Button>
      )}
    </div>
  );
}
