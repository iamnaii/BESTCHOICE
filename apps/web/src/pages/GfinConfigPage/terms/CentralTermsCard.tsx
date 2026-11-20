import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { TriangleAlert } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { NumberInput } from '@/components/ui/NumberInput';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { GfinTables } from '@/pages/ProductDetailPage/utils/gfinQuote';
import { RateFactorsTab } from '../RateFactorsTab';
import { GFIN_QUERY_KEYS } from '@/pages/ProductDetailPage/hooks/gfinQueryKeys';
import { commissionOptions, rateChips, settingsPatch, type CentralForm, type SettingsBody } from './centralTerms';

const SheetTag = ({ no }: { no: number }) => (
  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">ใบข้อ {no}</span>
);

export function CentralTermsCard({ tables, canEdit }: { tables: GfinTables; canEdit: boolean }) {
  const qc = useQueryClient();
  const s = tables.settings;
  const [edits, setEdits] = useState<Partial<CentralForm>>({});
  const [ratesOpen, setRatesOpen] = useState(false);
  const form: CentralForm = {
    minDownPct: edits.minDownPct ?? String(s.minDownPct),
    commissionPhone: edits.commissionPhone ?? String(s.commissionPctByCategory.PHONE),
    contractFee: edits.contractFee ?? String(s.contractFee),
  };
  const options = commissionOptions(tables.factors);
  const currentCommission = Number(form.commissionPhone);
  const chips = rateChips(tables.factors, currentCommission);
  const fees = [...new Set(tables.factors.filter((f) => f.isActive && f.shopCommissionPct === currentCommission).map((f) => Number(f.feePerInstallment)))];

  const save = useMutation({
    mutationFn: (body: SettingsBody) => api.patch('/gfin-config/settings', body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: GFIN_QUERY_KEYS.settings });
      setEdits({});
      toast.success('บันทึกค่ากลางแล้ว');
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const onSave = () => {
    const result = settingsPatch(s, form, options);
    if (!result.ok) return void toast.error(result.message);
    save.mutate(result.body);
  };

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card p-4">
      <div>
        <h2 className="text-lg font-semibold leading-snug">ค่ากลาง</h2>
        <p className="text-sm text-muted-foreground leading-snug">ใช้กับทุกรุ่น เว้นแต่ตั้งเฉพาะรุ่นในตารางด้านล่าง</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <div>
          <div className="flex items-center">
            <label htmlFor="gfin-min-down" className="text-sm font-medium leading-snug">
              เงินดาวน์ขั้นต่ำ (%)
            </label>
            <SheetTag no={2} />
          </div>
          <NumberInput
            id="gfin-min-down"
            min="0"
            max="80"
            step="1"
            value={form.minDownPct}
            disabled={!canEdit}
            onChange={(e) => setEdits((p) => ({ ...p, minDownPct: e.target.value }))}
          />
          <p className="mt-1 text-xs text-muted-foreground leading-snug">
            ลูกค้าเลือกเพิ่มได้ ขั้นละ {s.downStepPct}% ถึง {s.maxDownPct}%
          </p>
        </div>
        <div>
          <div className="flex items-center">
            <label htmlFor="gfin-commission" className="text-sm font-medium leading-snug">
              ค่าคอมมิชชั่น iPhone
            </label>
            <SheetTag no={3} />
          </div>
          <Select
            value={form.commissionPhone}
            onValueChange={(v) => setEdits((p) => ({ ...p, commissionPhone: v }))}
            disabled={!canEdit}
          >
            <SelectTrigger id="gfin-commission">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((o) => (
                <SelectItem key={o} value={String(o)}>
                  {o}% · มีตารางค่างวดแล้ว
                </SelectItem>
              ))}
              {!options.includes(currentCommission) && (
                <SelectItem value={String(currentCommission)} disabled>
                  {currentCommission}% — ยังไม่มีตารางค่างวด
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          <p className="mt-1 text-xs text-muted-foreground leading-snug">
            เลือกได้เฉพาะ % ที่มีตารางค่างวด · ไม่งั้น GFIN คิดผ่อนไม่ได้ทุกเครื่อง
          </p>
        </div>
        <div>
          <label htmlFor="gfin-contract-fee" className="text-sm font-medium leading-snug">
            ค่าทำสัญญาต่อเคส (บาท)
          </label>
          <NumberInput
            id="gfin-contract-fee"
            min="0"
            step="0.01"
            value={form.contractFee}
            disabled={!canEdit}
            onChange={(e) => setEdits((p) => ({ ...p, contractFee: e.target.value }))}
          />
          <p className="mt-1 text-xs text-muted-foreground leading-snug">GFIN หักจากยอดโอนให้ร้าน</p>
        </div>
      </div>
      <div className="space-y-2">
        <p className="text-sm font-medium leading-snug">
          ค่างวด GFIN คอม {currentCommission}% · ยอดจัด 10,000 บาท ผ่อนเดือนละ
          <SheetTag no={4} />
        </p>
        {chips.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-warning-strong leading-snug">
            <TriangleAlert className="size-4 shrink-0" aria-hidden="true" />
            ยังไม่มีตารางค่างวดของคอม {currentCommission}%
          </p>
        ) : (
          <ul className="flex flex-wrap gap-2" aria-label="ค่างวดต่อยอดจัด 10,000 บาท">
            {chips.map((c) => (
              <li key={c.months} className="rounded-md border border-border px-3 py-1.5 text-center">
                <span className="block text-xs text-muted-foreground">{c.months} งวด</span>
                <span className="font-medium tabular-nums">{c.monthly.toLocaleString('th-TH')}</span>
              </li>
            ))}
          </ul>
        )}
        {chips.length > 0 && (
          <p className="text-xs text-muted-foreground leading-snug">
            ตัวเลขบนสุดคือจำนวนงวด{fees.length === 1 ? ` · รวมค่าธรรมเนียม ${fees[0].toLocaleString('th-TH')} บาท/งวดแล้ว` : ''}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {canEdit && (
          <Button variant="primary" onClick={onSave} disabled={save.isPending}>
            บันทึกค่ากลาง
          </Button>
        )}
        {canEdit && (
          <Button variant="outline" onClick={() => setRatesOpen(true)}>
            แก้ตารางค่างวด
          </Button>
        )}
      </div>
      <Dialog open={ratesOpen} onOpenChange={setRatesOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>ตารางค่างวด GFIN</DialogTitle>
          </DialogHeader>
          <RateFactorsTab />
        </DialogContent>
      </Dialog>
    </section>
  );
}
