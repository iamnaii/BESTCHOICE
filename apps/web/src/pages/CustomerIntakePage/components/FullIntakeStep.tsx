import { useState, useEffect } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Loader2, Save } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { toast } from 'sonner';
import type { FullIntakeForm } from '../types';

interface Props {
  customerId: string;
  initial: FullIntakeForm;
  onDone: () => void;
}

export default function FullIntakeStep({ customerId, initial, onDone }: Props) {
  const [form, setForm] = useState<FullIntakeForm>(initial);
  useEffect(() => setForm(initial), [initial]);

  const patch = (p: Partial<FullIntakeForm>) => setForm((prev) => ({ ...prev, ...p }));
  const patchRef = (idx: number, p: Partial<FullIntakeForm['references'][number]>) =>
    setForm((prev) => ({
      ...prev,
      references: prev.references.map((r, i) => (i === idx ? { ...r, ...p } : r)),
    }));

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        name: `${form.firstName} ${form.lastName}`.trim(),
      };
      if (form.prefix) payload.prefix = form.prefix;
      if (form.nickname) payload.nickname = form.nickname;
      if (form.birthDate) payload.birthDate = new Date(form.birthDate).toISOString();
      if (form.phoneSecondary) payload.phoneSecondary = form.phoneSecondary;
      if (form.email) payload.email = form.email;
      if (form.lineId) payload.lineId = form.lineId;
      if (form.facebookLink) payload.facebookLink = form.facebookLink;
      if (form.facebookName) payload.facebookName = form.facebookName;
      if (form.occupation) payload.occupation = form.occupation;
      if (form.salary && !isNaN(parseFloat(form.salary))) payload.salary = parseFloat(form.salary);
      if (form.workplace) payload.workplace = form.workplace;
      const validRefs = form.references.filter((r) => r.firstName || r.lastName || r.phone);
      if (validRefs.length > 0) payload.references = validRefs;
      await api.patch(`/customers/${customerId}`, payload);
    },
    onSuccess: () => {
      toast.success('บันทึกข้อมูลลูกค้าสำเร็จ');
      onDone();
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const canSave =
    form.firstName.trim().length > 0 &&
    form.lastName.trim().length > 0;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold text-foreground">ข้อมูลติดต่อเพิ่มเติม</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">เบอร์โทรสำรอง</label>
            <Input value={form.phoneSecondary || ''} onChange={(e) => patch({ phoneSecondary: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">อีเมล</label>
            <Input type="email" value={form.email || ''} onChange={(e) => patch({ email: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">LINE ID</label>
            <Input value={form.lineId || ''} onChange={(e) => patch({ lineId: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">Facebook</label>
            <Input value={form.facebookName || ''} onChange={(e) => patch({ facebookName: e.target.value })} placeholder="ชื่อ/ลิงก์" />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold text-foreground">อาชีพ</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">อาชีพ</label>
            <Input value={form.occupation || ''} onChange={(e) => patch({ occupation: e.target.value })} />
          </div>
          <div>
            <label className="block text-xs font-medium text-foreground mb-1">เงินเดือน (บาท)</label>
            <Input type="number" value={form.salary || ''} onChange={(e) => patch({ salary: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-foreground mb-1">สถานที่ทำงาน</label>
            <Input value={form.workplace || ''} onChange={(e) => patch({ workplace: e.target.value })} />
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-sm space-y-4">
        <h3 className="text-sm font-semibold text-foreground">ผู้อ้างอิง (4 คน)</h3>
        {form.references.map((ref, i) => (
          <div key={i} className="grid grid-cols-1 md:grid-cols-4 gap-2 pb-3 border-b border-border last:border-0">
            <Input placeholder="ชื่อ" value={ref.firstName} onChange={(e) => patchRef(i, { firstName: e.target.value })} />
            <Input placeholder="นามสกุล" value={ref.lastName} onChange={(e) => patchRef(i, { lastName: e.target.value })} />
            <Input placeholder="เบอร์" value={ref.phone} onChange={(e) => patchRef(i, { phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} />
            <Input placeholder="ความสัมพันธ์" value={ref.relationship} onChange={(e) => patchRef(i, { relationship: e.target.value })} />
          </div>
        ))}
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="primary" size="lg" onClick={() => saveMut.mutate()} disabled={!canSave || saveMut.isPending}>
          {saveMut.isPending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          บันทึก
        </Button>
      </div>
    </div>
  );
}
