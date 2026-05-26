import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useBulkDispatch } from '../hooks/useBulkDispatch';
import type { LetterRow } from '../types';

interface Props {
  open: boolean;
  rows: LetterRow[];
  onClose: () => void;
}

const EMS_REGEX = /^[A-Z]{2}\d{9}TH$/i;

export default function BulkDispatchDialog({ open, rows, onClose }: Props) {
  const [trackingMap, setTrackingMap] = useState<Record<string, string>>({});
  const [bookletPrefix, setBookletPrefix] = useState('');
  const [bookletStart, setBookletStart] = useState('');
  const { mutate, isPending } = useBulkDispatch();

  useEffect(() => {
    if (open) {
      setTrackingMap(Object.fromEntries(rows.map((r) => [r.id, ''])));
      setBookletPrefix('');
      setBookletStart('');
    }
  }, [open, rows]);

  const applyBooklet = () => {
    if (!bookletPrefix || !bookletStart) return;
    const startNum = parseInt(bookletStart, 10);
    if (Number.isNaN(startNum)) return;
    const next: Record<string, string> = {};
    rows.forEach((r, idx) => {
      const n = String(startNum + idx).padStart(9, '0');
      next[r.id] = `${bookletPrefix}${n}TH`;
    });
    setTrackingMap(next);
  };

  const submit = () => {
    const items = rows.map((r) => ({
      id: r.id,
      trackingNumber: (trackingMap[r.id] ?? '').trim(),
    }));
    mutate(items, { onSuccess: () => onClose() });
  };

  const allFilled = rows.every((r) => (trackingMap[r.id] ?? '').trim().length >= 5);

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>บันทึกการส่ง {rows.length} ฉบับ</DialogTitle>
        </DialogHeader>

        <div className="flex gap-2 items-end p-3 bg-muted rounded-md">
          <div>
            <label className="text-xs text-muted-foreground">Prefix</label>
            <Input
              placeholder="EM"
              value={bookletPrefix}
              onChange={(e) => setBookletPrefix(e.target.value.toUpperCase())}
              className="w-20"
              maxLength={2}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">เลขเริ่ม</label>
            <Input
              placeholder="123456789"
              value={bookletStart}
              onChange={(e) => setBookletStart(e.target.value)}
              className="w-32"
              maxLength={9}
            />
          </div>
          <Button size="sm" variant="outline" onClick={applyBooklet}>
            ใช้ tracking ต่อเนื่อง
          </Button>
        </div>

        <div className="max-h-[400px] overflow-y-auto space-y-2 mt-2">
          {rows.map((r) => {
            const val = trackingMap[r.id] ?? '';
            const isValidFormat = !val || EMS_REGEX.test(val);
            return (
              <div key={r.id} className="flex gap-3 items-center p-2 border border-border rounded">
                <div className="flex-1">
                  <div className="text-sm font-medium">{r.contract.customer.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{r.letterNumber}</div>
                </div>
                <div className="w-48">
                  <Input
                    placeholder="EM123456789TH"
                    value={val}
                    onChange={(e) =>
                      setTrackingMap((prev) => ({ ...prev, [r.id]: e.target.value }))
                    }
                    className={!isValidFormat ? 'border-amber-400' : ''}
                  />
                  {!isValidFormat && (
                    <p className="text-xs text-amber-600 mt-0.5">รูปแบบไม่ใช่ไปรษณีย์ไทย</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={isPending}>ยกเลิก</Button>
          <Button onClick={submit} disabled={!allFilled || isPending}>
            {isPending ? 'กำลังบันทึก...' : `ยืนยันส่ง ${rows.length} ฉบับ`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
