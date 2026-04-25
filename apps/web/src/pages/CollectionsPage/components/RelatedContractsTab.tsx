import { useQuery } from '@tanstack/react-query';
import { Loader2, FileText, ChevronRight } from 'lucide-react';
import api from '@/lib/api';

interface RelatedContract {
  id: string;
  contractNumber: string;
  status: string;
  totalAmount?: number;
  remainingBalance?: number;
  installmentCount: number;
  branch: { id: string; name: string };
  product?: { id: string; name: string; brand?: string; model?: string };
  createdAt: string;
}

interface Props {
  customerId: string | null;
  currentContractId: string;
  onSelectContract: (contractId: string) => void;
}

/**
 * RelatedContractsTab — lists every contract for the current customer so a
 * collector can hop between them without leaving the Customer 360 panel
 * (P2 Task 5). Hidden when the customer only has one contract.
 */
export default function RelatedContractsTab({
  customerId,
  currentContractId,
  onSelectContract,
}: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['customer-contracts', customerId],
    queryFn: async () => {
      const res = await api.get(`/customers/${customerId}/contracts`);
      return res.data as RelatedContract[];
    },
    enabled: !!customerId,
    staleTime: 60_000,
  });

  if (!customerId) return null;
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
      </div>
    );
  }
  if (isError) {
    return (
      <div className="text-sm text-destructive leading-snug">
        ไม่สามารถโหลดสัญญาของลูกค้าได้
      </div>
    );
  }
  const contracts = data ?? [];
  if (contracts.length <= 1) {
    return (
      <div className="text-xs text-muted-foreground leading-snug">
        ไม่มีสัญญาอื่นของลูกค้านี้
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {contracts.map((c) => {
        const isCurrent = c.id === currentContractId;
        return (
          <li key={c.id}>
            <button
              type="button"
              disabled={isCurrent}
              onClick={() => onSelectContract(c.id)}
              className={`w-full flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-left transition-colors ${
                isCurrent
                  ? 'bg-muted cursor-default'
                  : 'bg-card hover:bg-accent'
              }`}
              aria-current={isCurrent ? 'true' : undefined}
            >
              <div className="flex items-start gap-2 min-w-0">
                <FileText className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-mono tabular-nums text-primary leading-snug truncate">
                    {c.contractNumber}
                  </div>
                  <div className="text-xs text-muted-foreground leading-snug truncate">
                    {c.product?.name ?? 'ไม่ระบุสินค้า'} · {c.branch.name}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs rounded-full bg-muted px-2 py-0.5 text-muted-foreground">
                  {c.status}
                </span>
                {!isCurrent && <ChevronRight className="size-4 text-muted-foreground" />}
                {isCurrent && (
                  <span className="text-xs text-muted-foreground">ปัจจุบัน</span>
                )}
              </div>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
