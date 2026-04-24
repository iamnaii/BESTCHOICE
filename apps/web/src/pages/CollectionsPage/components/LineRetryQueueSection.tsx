import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { useFailedActions, useRetryAction } from '../hooks/useLineRetry';
import { formatDateShort } from '@/utils/formatters';

export default function LineRetryQueueSection() {
  const { data: actions = [], isLoading } = useFailedActions();
  const retry = useRetryAction();

  return (
    <Card className="rounded-xl border border-border/50 bg-card shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-destructive" />
            <h3 className="text-sm font-semibold leading-snug">ส่งไม่สำเร็จ รอลองใหม่</h3>
          </div>
          <span className="text-xs tabular-nums bg-muted text-muted-foreground rounded-full px-2 py-0.5">
            {actions.length}
          </span>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[0, 1].map((i) => (
              <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        ) : actions.length === 0 ? (
          <div className="rounded-lg border border-dashed border-success/30 bg-success/5 py-8 text-center">
            <div className="text-sm font-medium text-success leading-snug">
              ไม่มีรายการที่ส่งไม่สำเร็จ
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {actions.map((a) => (
              <div
                key={a.id}
                className="flex items-start gap-3 rounded-lg border border-border/50 p-3 bg-background"
              >
                <div className="shrink-0 size-8 rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
                  <AlertTriangle className="size-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2 mb-0.5">
                    <span className="text-sm font-semibold leading-snug truncate">
                      {a.contract.customer.name}
                    </span>
                    <span className="font-mono text-[10px] text-primary">
                      {a.contract.contractNumber}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      · {a.dunningRule.name}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground leading-snug line-clamp-2">
                    {a.messageContent?.substring(0, 120)}
                    {(a.messageContent?.length ?? 0) > 120 ? '…' : ''}
                  </div>
                  {a.result && (
                    <div className="text-[10px] text-destructive mt-1 leading-snug">
                      Error: {a.result}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground mt-1 tabular-nums">
                    ครั้งแรก: {formatDateShort(new Date(a.createdAt))}
                  </div>
                </div>
                <button
                  onClick={() => retry.mutate(a.id)}
                  disabled={retry.isPending}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw className={`size-3.5 ${retry.isPending ? 'animate-spin' : ''}`} />
                  ลองอีกครั้ง
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
