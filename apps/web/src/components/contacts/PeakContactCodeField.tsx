import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import api, { getErrorMessage } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { contactKeys } from '@/lib/api/contacts';

/**
 * mapping v5 (ฝ่ายบัญชี 19/10/2569 · เจ้าของ 20/10 "ทำรหัสย่อยได้เลย"): the PEAK
 * journal export uses each contact's PEAK contact code ("รหัสผู้ติดต่อ" C00xxx)
 * as the sub-code of its receivable / payable lines. OWNER / ACCOUNTANT set it
 * here; everyone else just reads it.
 */
const PEAK_CODE_RE = /^[A-Za-z0-9\-_.]{0,20}$/;

export function PeakContactCodeField({
  contactId,
  value,
  canEdit,
}: {
  contactId: string;
  value: string | null | undefined;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(value ?? '');
  const trimmed = draft.trim();
  const dirty = trimmed !== (value ?? '');

  const save = useMutation({
    mutationFn: async () =>
      (await api.patch(`/contacts/${contactId}/peak-code`, { peakContactCode: trimmed.length > 0 ? trimmed : null })).data,
    onSuccess: () => {
      toast.success(trimmed.length > 0 ? `บันทึกรหัสผู้ติดต่อ PEAK ${trimmed} แล้ว` : 'ล้างรหัสผู้ติดต่อ PEAK แล้ว');
      queryClient.invalidateQueries({ queryKey: contactKeys.detail(contactId) });
    },
    onError: (err) => toast.error(getErrorMessage(err)),
  });

  function onSave() {
    if (!PEAK_CODE_RE.test(trimmed)) {
      toast.error('รหัสผู้ติดต่อ PEAK ต้องเป็น A-Z 0-9 - _ . และยาวไม่เกิน 20 ตัวอักษร');
      return;
    }
    save.mutate();
  }

  return (
    <div>
      <div className="text-xs text-muted-foreground mb-0.5 leading-snug">รหัสผู้ติดต่อ PEAK</div>
      {canEdit ? (
        <div className="flex items-center gap-1.5">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="เช่น C00790"
            maxLength={20}
            aria-label="รหัสผู้ติดต่อ PEAK"
            className="h-8 max-w-[160px] font-mono text-sm"
            disabled={save.isPending}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onSave}
            disabled={!dirty || save.isPending}
            aria-label="บันทึกรหัส PEAK"
          >
            <Save className="size-4" aria-hidden />
          </Button>
        </div>
      ) : (
        <div className="text-sm text-foreground leading-snug font-mono">{value || '—'}</div>
      )}
    </div>
  );
}
