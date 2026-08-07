import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { BcCalculatorCard } from './BcCalculatorCard';
import { GfinCalculatorCard } from './GfinCalculatorCard';
import { getDisplayPrices } from '@/utils/getDisplayPrices';

interface Props {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  product: any;
  /** เปิดตัวแก้ราคาใหม่ของ B1 — แทนลิงก์ตาย /products/:id/edit */
  onEditPrice: () => void;
  canEditPrice: boolean; // OWNER | BRANCH_MANAGER
}

interface BcConfigResponse {
  minDownPct: number;
  commissionPct: number;
  vatPct: number;
  ratePctByMonths: Record<number, number>;
  allowedMonths: number[];
}

export function InstallmentCalculatorCard({ product, onEditPrice, canEditPrice }: Props) {
  const { user } = useAuth();
  const { installment } = getDisplayPrices(product);
  const canCreateContract =
    user?.role === 'OWNER' || user?.role === 'BRANCH_MANAGER' || user?.role === 'SALES';

  const { data: bcConfig, isLoading } = useQuery({
    queryKey: ['interest-config', product.category, 'bc'],
    queryFn: () =>
      api
        .get<BcConfigResponse>(`/interest-configs/resolved?category=${product.category}`)
        .then((r) => r.data),
    enabled: !!product.category && !!installment,
  });

  if (!installment) {
    return (
      <div className="rounded-md bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 p-4 text-sm leading-snug">
        ยังไม่ได้กำหนดราคาเงินผ่อน
        {canEditPrice ? (
          <button
            type="button"
            onClick={onEditPrice}
            className="ml-2 underline text-amber-700 dark:text-amber-400"
          >
            ไปแก้ราคา
          </button>
        ) : (
          <span className="ml-2 text-amber-700 dark:text-amber-400">
            — แจ้งผู้จัดการให้กำหนดราคา
          </span>
        )}
      </div>
    );
  }

  if (isLoading || !bcConfig) {
    return <div className="text-sm text-muted-foreground">กำลังโหลด config...</div>;
  }

  const hideCommission = user?.role === 'SALES';

  return (
    <section className="space-y-3">
      <h3 className="text-lg font-semibold leading-snug">เครื่องคำนวณค่างวด</h3>
      <div className="grid md:grid-cols-2 gap-4">
        <BcCalculatorCard
          productId={product.id}
          installmentPrice={Number(installment)}
          hideCommission={hideCommission}
          canCreateContract={canCreateContract}
          config={bcConfig}
        />
        <GfinCalculatorCard
          productId={product.id}
          installmentPrice={Number(installment)}
          product={{
            brand: product.brand,
            model: product.model,
            storage: product.storage,
            category: product.category === 'PHONE_NEW' ? 'PHONE_NEW' : 'PHONE_USED',
          }}
        />
      </div>
    </section>
  );
}
