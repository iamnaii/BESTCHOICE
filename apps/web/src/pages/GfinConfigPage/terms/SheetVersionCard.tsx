import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileText } from 'lucide-react';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { GfinSettingsApi } from '@/pages/ProductDetailPage/utils/gfinQuote';
import { GFIN_QUERY_KEYS } from '../gfinQueryKeys';
import { sheetVersionText } from './centralTerms';

export function SheetVersionCard({ settings, canEdit }: { settings: GfinSettingsApi; canEdit: boolean }) {
  const qc = useQueryClient();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState('');
  const [date, setDate] = useState('');

  const save = useMutation({
    mutationFn: () =>
      api.patch('/gfin-config/settings', { sheetVersion: version.trim(), sheetEffectiveDate: date }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: GFIN_QUERY_KEYS.settings });
      toast.success('บันทึกเวอร์ชันใบเงื่อนไขแล้ว');
      setOpen(false);
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  const openDialog = () => {
    setVersion(settings.sheetVersion ?? '');
    setDate(settings.sheetEffectiveDate ?? '');
    setOpen(true);
  };

  return (
    <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <FileText className="mt-0.5 size-5 text-muted-foreground" aria-hidden="true" />
        <div>
          <p className="font-medium leading-snug">{sheetVersionText(settings)}</p>
          <p className="text-sm text-muted-foreground leading-snug">
            ป้ายเลขข้อ (ใบข้อ 2, 3 …) ตรงกับใบของ GFIN · ไล่เทียบกับใบได้ทีละข้อ
          </p>
        </div>
      </div>
      {canEdit && (
        <Button variant="outline" onClick={openDialog}>
          เปลี่ยนเป็นเวอร์ชันใหม่
        </Button>
      )}
      <Dialog open={open} onOpenChange={(o) => !save.isPending && setOpen(o)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เวอร์ชันใบเงื่อนไข G Finn</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label htmlFor={`${id}-v`} className="text-sm font-medium leading-snug">
                เวอร์ชัน
              </label>
              <Input id={`${id}-v`} value={version} maxLength={20} onChange={(e) => setVersion(e.target.value)} placeholder="เช่น 6.5" />
            </div>
            <div>
              <label htmlFor={`${id}-d`} className="text-sm font-medium leading-snug">
                ใช้ตั้งแต่
              </label>
              <ThaiDateInput id={`${id}-d`} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={save.isPending}>
              ยกเลิก
            </Button>
            <Button variant="primary" onClick={() => save.mutate()} disabled={save.isPending || !version.trim() || !date}>
              บันทึกเวอร์ชัน
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
