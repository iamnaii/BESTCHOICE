import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import api from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export function MatchPreviewPanel() {
  const [productId, setProductId] = useState('');
  const [result, setResult] = useState<unknown>(null);

  const test = useMutation({
    mutationFn: async () => {
      const { data } = await api.get(
        `/gfin-config/match-preview?productId=${encodeURIComponent(productId)}`,
      );
      return data;
    },
    onSuccess: (data) => setResult(data),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (err: any) => {
      const msg = err.response?.data?.message ?? String(err);
      setResult({ error: msg });
      toast.error(msg);
    },
  });

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground leading-snug">
        ป้อน Product ID เพื่อทดสอบว่าระบบจับคู่กับ GFIN config ได้ถูกต้องหรือไม่
      </p>
      <div className="flex gap-2 max-w-xl">
        <Input
          placeholder="Product ID"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && productId) test.mutate();
          }}
        />
        <Button
          variant="primary"
          onClick={() => test.mutate()}
          disabled={!productId || test.isPending}
        >
          ทดสอบ Match
        </Button>
      </div>
      {result !== null && (
        <div className="rounded border bg-muted p-4">
          <pre className="text-xs overflow-x-auto leading-snug">
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
