import { useState } from 'react';
import { Phone, Loader2 } from 'lucide-react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface CallButtonProps {
  customerId: string;
  contractId: string;
  phone?: string;
  className?: string;
  variant?: 'default' | 'ghost' | 'outline';
  size?: 'default' | 'sm' | 'icon';
}

export function CallButton({
  customerId,
  contractId,
  phone,
  className,
  variant = 'ghost',
  size = 'sm',
}: CallButtonProps) {
  const [status, setStatus] = useState<'idle' | 'calling' | 'connected'>('idle');

  const { mutate: originate, isPending } = useMutation({
    mutationFn: () =>
      api.post('/yeastar/call/originate', { customerId, contractId }).then((r) => r.data),
    onMutate: () => setStatus('calling'),
    onSuccess: () => {
      setStatus('connected');
      toast.success('กำลังโทรออก — รับสายจากโทรศัพท์ของคุณ');
      setTimeout(() => setStatus('idle'), 10_000);
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setStatus('idle');
      toast.error(err?.response?.data?.message ?? 'โทรออกไม่สำเร็จ');
    },
  });

  return (
    <Button
      variant={variant}
      size={size}
      className={cn('gap-1.5', className)}
      onClick={() => originate()}
      disabled={isPending || status === 'calling' || status === 'connected'}
      title={phone ? `โทร ${phone}` : 'โทรออก'}
    >
      {isPending || status === 'calling' ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Phone className={cn('h-4 w-4', status === 'connected' && 'text-emerald-500')} />
      )}
      {size !== 'icon' && (phone ?? 'โทร')}
    </Button>
  );
}
