import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Modal from '@/components/ui/Modal';
import api from '@/lib/api';
import { useAdHocLine } from '../hooks/useAdHocLine';
import type { ContractRow } from '../types';

interface Props {
  open: boolean;
  contract: ContractRow | null;
  onClose: () => void;
}

interface DunningRule {
  id: string;
  name: string;
  messageTemplate: string;
}

type Mode = 'template' | 'custom';

function modeBtn(active: boolean): string {
  return `px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
    active
      ? 'border-primary bg-primary/5 text-primary'
      : 'border-input hover:bg-muted text-muted-foreground'
  }`;
}

/**
 * Substitutes known contract placeholders with actual values for preview.
 * Unknown {{vars}} are replaced with ··· so collector can spot them.
 */
function substituteTemplate(template: string, contract: ContractRow): string {
  return template
    .replace(/\{\{customerName\}\}/g, contract.customer.name)
    .replace(/\{\{contractNumber\}\}/g, contract.contractNumber)
    .replace(/\{\{amount\}\}/g, contract.outstanding.toLocaleString())
    .replace(/\{\{daysOverdue\}\}/g, String(contract.daysOverdue))
    .replace(/\{\{(\w+)\}\}/g, '···');
}

export default function SendLineAdHocDialog({ open, contract, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('template');
  const [templateId, setTemplateId] = useState('');
  const [customMessage, setCustomMessage] = useState('');

  const mutation = useAdHocLine();

  // Fetch dunning rules (event-trigger pool) when dialog opens
  const { data: rules = [] } = useQuery<DunningRule[]>({
    queryKey: ['dunning-rules'],
    queryFn: async () => {
      const { data } = await api.get('/overdue/dunning-rules');
      const list = Array.isArray(data) ? data : data?.data ?? [];
      return list as DunningRule[];
    },
    enabled: open,
  });

  // Reset state when dialog opens for a new contract
  useEffect(() => {
    if (open) {
      setMode('template');
      setTemplateId('');
      setCustomMessage('');
    }
  }, [open, contract?.id]);

  const selectedRule = rules.find((r) => r.id === templateId);

  const canSubmit =
    (mode === 'template' && !!templateId) ||
    (mode === 'custom' && customMessage.trim().length >= 10);

  function handleSubmit() {
    if (!contract || !canSubmit) return;
    mutation.mutate(
      {
        contractId: contract.id,
        templateId: mode === 'template' ? templateId : undefined,
        customMessage: mode === 'custom' ? customMessage.trim() : undefined,
      },
      {
        onSuccess: () => {
          onClose();
        },
      },
    );
  }

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title={`ส่ง LINE ถึง ${contract?.customer.name ?? ''}`}
      size="md"
    >
      <div className="space-y-4">
        {/* Mode toggle */}
        <div className="flex gap-2">
          <button onClick={() => setMode('template')} className={modeBtn(mode === 'template')}>
            ใช้ template
          </button>
          <button onClick={() => setMode('custom')} className={modeBtn(mode === 'custom')}>
            พิมพ์เอง
          </button>
        </div>

        {mode === 'template' ? (
          <div className="space-y-3">
            <select
              value={templateId}
              onChange={(e) => setTemplateId(e.target.value)}
              className="w-full px-3 py-2 border border-input rounded-lg text-sm leading-snug"
            >
              <option value="">— เลือก template —</option>
              {rules.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>

            {/* Message preview with substituted vars */}
            {selectedRule && contract && (
              <div className="rounded-lg bg-muted/50 border border-border p-3">
                <div className="text-xs text-muted-foreground mb-1.5 leading-snug">
                  ตัวอย่างข้อความ
                </div>
                <div className="text-sm whitespace-pre-wrap leading-snug">
                  {substituteTemplate(selectedRule.messageTemplate, contract)}
                </div>
              </div>
            )}

            {rules.length === 0 && (
              <div className="text-xs text-muted-foreground italic leading-snug">
                ยังไม่มี dunning rules — สร้างในหน้าตั้งค่าก่อน
              </div>
            )}
          </div>
        ) : (
          <div>
            <textarea
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              rows={5}
              placeholder="พิมพ์ข้อความถึงลูกค้า..."
              className="w-full px-3 py-2 border border-input rounded-lg text-sm resize-none leading-snug"
              autoFocus
            />
            <div className="mt-1 text-xs text-muted-foreground leading-snug">
              {customMessage.length} ตัวอักษร (ขั้นต่ำ 10)
            </div>
          </div>
        )}

        {/* Submit */}
        <div className="flex justify-end gap-2 pt-1">
          <button
            onClick={onClose}
            disabled={mutation.isPending}
            className="px-4 py-2 text-sm rounded-lg border border-input hover:bg-muted transition-colors disabled:opacity-50"
          >
            ยกเลิก
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || mutation.isPending}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? 'กำลังส่ง...' : 'ส่ง LINE'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
