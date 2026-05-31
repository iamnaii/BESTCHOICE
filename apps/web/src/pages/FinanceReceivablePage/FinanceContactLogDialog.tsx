import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import Modal from '@/components/ui/Modal';
import { Button } from '@/components/ui/button';
import ThaiDateInput from '@/components/ui/ThaiDateInput';
import {
  financeContactApi,
  financeContactKeys,
  FinanceContactLog,
} from '@/lib/api/finance-contacts';
import { getErrorMessage } from '@/lib/api';

interface Props {
  receivableId: string;
  companyId: string;
  outstanding: number;
  open: boolean;
  onClose: () => void;
}

const RESULT_OPTIONS: Array<{ value: FinanceContactLog['result']; label: string; tone: string }> = [
  { value: 'ANSWERED', label: 'รับสาย', tone: 'bg-emerald-100 text-emerald-700' },
  { value: 'NO_ANSWER', label: 'ไม่รับ', tone: 'bg-muted text-muted-foreground' },
  { value: 'PROMISED', label: 'รับปาก', tone: 'bg-amber-100 text-amber-700' },
  { value: 'DISPUTED', label: 'โต้แย้ง', tone: 'bg-red-100 text-red-700' },
  { value: 'REQUESTED_DOCS', label: 'ขอเอกสาร', tone: 'bg-blue-100 text-blue-700' },
  { value: 'OTHER', label: 'อื่นๆ', tone: 'bg-secondary text-secondary-foreground' },
];

export default function FinanceContactLogDialog({
  receivableId,
  companyId,
  outstanding,
  open,
  onClose,
}: Props) {
  const qc = useQueryClient();
  const [contactId, setContactId] = useState<string | undefined>();
  const [result, setResult] = useState<FinanceContactLog['result']>('ANSWERED');
  const [notes, setNotes] = useState('');
  const [promisedDate, setPromisedDate] = useState('');
  const [promisedAmount, setPromisedAmount] = useState<string>(String(outstanding));

  const { data: contacts } = useQuery({
    queryKey: financeContactKeys.companyContacts(companyId),
    queryFn: () => financeContactApi.listContacts(companyId),
    enabled: open && !!companyId,
  });

  const submit = useMutation({
    mutationFn: () =>
      financeContactApi.recordLog(receivableId, {
        financeCompanyContactId: contactId,
        result,
        notes: notes.trim() || undefined,
        promisedDate: result === 'PROMISED' ? promisedDate : undefined,
        promisedAmount: result === 'PROMISED' ? Number(promisedAmount) : undefined,
      }),
    onSuccess: () => {
      toast.success('บันทึกการติดต่อสำเร็จ');
      qc.invalidateQueries({ queryKey: financeContactKeys.receivableLogs(receivableId) });
      qc.invalidateQueries({ queryKey: ['finance-receivable'] });
      onClose();
    },
    onError: (e) => toast.error(getErrorMessage(e)),
  });

  if (!open) return null;

  return (
    <Modal isOpen={open} onClose={onClose} title="บันทึกการติดต่อไฟแนนซ์">
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">ผู้ติดต่อ</label>
          <select
            className="w-full px-3 py-2 border border-input rounded-lg bg-background"
            value={contactId ?? ''}
            onChange={(e) => setContactId(e.target.value || undefined)}
          >
            <option value="">— ไม่ระบุ —</option>
            {contacts?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.position ? ` (${c.position})` : ''}
                {c.isPrimary ? ' ★ ตัวหลัก' : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-2">ผลการติดต่อ</label>
          <div className="flex flex-wrap gap-2">
            {RESULT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setResult(opt.value)}
                className={`px-3 py-1.5 rounded-full text-sm border ${
                  result === opt.value
                    ? `${opt.tone} border-current font-medium`
                    : 'border-border text-muted-foreground hover:bg-accent'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {result === 'PROMISED' && (
          <div className="space-y-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div>
              <label className="block text-sm font-medium mb-1">วันที่นัดโอน</label>
              <ThaiDateInput
                value={promisedDate}
                onChange={(e) => setPromisedDate(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">ยอดที่นัด (บาท)</label>
              <input
                type="number"
                className="w-full px-3 py-2 border border-input rounded-lg bg-background"
                value={promisedAmount}
                onChange={(e) => setPromisedAmount(e.target.value)}
                min={0}
                step={0.01}
              />
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-2">โน้ต</label>
          <textarea
            className="w-full px-3 py-2 border border-input rounded-lg bg-background"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="รายละเอียดการคุย…"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button
            onClick={() => submit.mutate()}
            disabled={submit.isPending || (result === 'PROMISED' && !promisedDate)}
          >
            {submit.isPending ? 'กำลังบันทึก…' : 'บันทึก'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
