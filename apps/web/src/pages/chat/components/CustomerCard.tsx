import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { fetchCustomerSummary } from '../lib/chat-api';

/**
 * CustomerCard — compact customer info for the chat assistant sidebar.
 * Fetches `/customers/:id/summary` (cheap projection: name, phone,
 * active-contract count, overdue count, total outstanding).
 * Staff click the name to deep-link into the full customer detail page.
 */
export function CustomerCard({ customerId }: { customerId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['customer-summary', customerId],
    queryFn: () => fetchCustomerSummary(customerId),
    enabled: !!customerId,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-3">
          <div className="text-xs leading-snug text-muted-foreground">กำลังโหลด...</div>
        </CardContent>
      </Card>
    );
  }

  if (!data) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm leading-snug">
          <Link
            to={`/customers/${data.id}`}
            className="text-primary hover:underline"
          >
            {data.name}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs leading-snug text-muted-foreground">
        <div>โทร: {data.phone ?? '-'}</div>
        <div className="flex flex-wrap gap-1">
          <Badge variant="secondary">{data.activeContracts} สัญญา</Badge>
          {data.overdueCount > 0 && (
            <Badge variant="destructive">ค้าง {data.overdueCount} งวด</Badge>
          )}
        </div>
        <div>
          คงค้าง:{' '}
          <span className="font-medium text-foreground">
            {data.totalOutstandingThb.toLocaleString('th-TH', {
              minimumFractionDigits: 0,
              maximumFractionDigits: 2,
            })}
          </span>{' '}
          บาท
        </div>
      </CardContent>
    </Card>
  );
}
