import { useState } from 'react';
import { Plus, X, Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  useApplyCustomerTag,
  useCustomerTags,
  useRemoveCustomerTag,
  type CustomerTagType,
} from '../hooks/useCustomerTags';
import CustomerTagChips from './CustomerTagChips';

interface Props {
  open: boolean;
  onClose: () => void;
  customerId: string | null;
}

const ALL_TAGS: { value: CustomerTagType; label: string; help: string }[] = [
  {
    value: 'VIP',
    label: 'VIP',
    help: 'ลูกค้าระดับ VIP — ปกติ tag นี้ apply อัตโนมัติเมื่อมี ≥3 สัญญา',
  },
  {
    value: 'HIGH_RISK',
    label: 'เสี่ยงสูง',
    help: 'ผิดนัดบ่อย — auto apply เมื่อ broken-promise ≥3 ใน 90 วัน',
  },
  {
    value: 'NEW',
    label: 'ลูกค้าใหม่',
    help: 'สัญญาแรกอายุ <30 วัน',
  },
  {
    value: 'LOYAL',
    label: 'ลูกค้าประจำ',
    help: 'เป็นลูกค้า >2 ปี และไม่เคยผิดนัด',
  },
  {
    value: 'BLACKLIST',
    label: 'BLACKLIST',
    help: 'manual เท่านั้น — ห้ามทำสัญญาใหม่',
  },
];

export default function CustomerTagDialog({ open, onClose, customerId }: Props) {
  const { data: tags = [], isLoading } = useCustomerTags(customerId);
  const apply = useApplyCustomerTag();
  const remove = useRemoveCustomerTag();

  const [selectedTag, setSelectedTag] = useState<CustomerTagType | ''>('');
  const [reason, setReason] = useState('');

  const handleAdd = async () => {
    if (!customerId || !selectedTag) return;
    await apply.mutateAsync({ customerId, tag: selectedTag, reason: reason || undefined });
    setSelectedTag('');
    setReason('');
  };

  const handleRemove = (id: string) => {
    if (!customerId) return;
    void remove.mutate({ id, customerId });
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (!v ? onClose() : undefined)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>จัดการ Tags</DialogTitle>
          <DialogDescription>
            เพิ่ม / ลบ tag manual สำหรับลูกค้า — auto tags จะถูก recompute อัตโนมัติทุกคืน
          </DialogDescription>
        </DialogHeader>

        <section className="space-y-4">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
              tags ปัจจุบัน
            </div>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                กำลังโหลด...
              </div>
            ) : tags.length === 0 ? (
              <div className="text-sm text-muted-foreground italic leading-snug">
                ยังไม่มี tag
              </div>
            ) : (
              <ul className="space-y-1.5" data-testid="customer-tag-list">
                {tags.map((t) => (
                  <li
                    key={t.id}
                    className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2"
                  >
                    <div className="flex flex-col gap-1 min-w-0">
                      <CustomerTagChips tags={[{ tag: t.tag }]} compact />
                      <div className="text-2xs text-muted-foreground leading-snug truncate">
                        {t.source} {t.reason ? `· ${t.reason}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemove(t.id)}
                      disabled={remove.isPending}
                      className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                      title="ลบ tag นี้"
                      aria-label={`ลบ ${t.tag}`}
                    >
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-2 border-t border-border pt-4">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              เพิ่ม tag manual
            </div>
            <div className="space-y-2">
              <div>
                <Label htmlFor="tag-select">tag</Label>
                <Select
                  value={selectedTag}
                  onValueChange={(v) => setSelectedTag(v as CustomerTagType)}
                >
                  <SelectTrigger id="tag-select">
                    <SelectValue placeholder="เลือก tag..." />
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_TAGS.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedTag && (
                  <div className="text-2xs text-muted-foreground mt-1 leading-snug">
                    {ALL_TAGS.find((t) => t.value === selectedTag)?.help}
                  </div>
                )}
              </div>
              <div>
                <Label htmlFor="tag-reason">เหตุผล (optional)</Label>
                <input
                  id="tag-reason"
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="เช่น: มีรายการฉ้อโกง"
                  className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end pt-2">
              <Button
                onClick={handleAdd}
                disabled={!selectedTag || apply.isPending}
                size="sm"
              >
                <Plus className="size-4" />
                เพิ่ม tag
              </Button>
            </div>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
