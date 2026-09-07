import { Link, useSearchParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { contractReturnUrl } from '@/lib/contract-return';
import { Button } from '@/components/ui/button';

export default function ContractReturnNotice({ customerId }: { customerId?: string }) {
  const [params] = useSearchParams();
  const returnTo = contractReturnUrl(params.get('returnTo'));
  if (!returnTo || (customerId &&
    new URL(returnTo, 'https://internal.invalid').searchParams.get('customerId') !== customerId)) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <p className="text-sm leading-snug">ร่างสัญญาบันทึกไว้แล้ว กลับไปทำต่อได้หลังตรวจเครดิต ระบบจะตรวจผลอนุมัติอีกครั้ง</p>
      <Button asChild variant="outline" className="shrink-0">
        <Link to={returnTo}><ArrowLeft className="size-4" />กลับไปทำสัญญาต่อ</Link>
      </Button>
    </div>
  );
}
