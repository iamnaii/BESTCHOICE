import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type {
  ChatAnalyticsPeriod,
  ChatAnalyticsPage,
  ChatCycleDetail,
  ChatOpenWorkDetail,
  ChatWorkMetricDetail,
  ChatLinkedSale,
  ChatFunnelCustomer,
} from '@installment/shared';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { analyticsDate, formatMetric, formatDocumentAmount } from './analytics-format';
export type Drill = {
  endpoint: 'cycles' | 'open-work' | 'work-details' | 'sales' | 'funnel-details';
  title: string;
  filters?: Record<string, string>;
};
type Row =
  | ChatCycleDetail
  | ChatOpenWorkDetail
  | ChatWorkMetricDetail
  | ChatLinkedSale
  | ChatFunnelCustomer;
export default function AnalyticsDrilldown({
  drill,
  params,
  scopeKey,
  onClose,
}: {
  drill: Drill;
  params: ChatAnalyticsPeriod;
  scopeKey: unknown[];
  onClose: () => void;
}) {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: [...scopeKey, 'drill', params, drill, page],
    queryFn: () =>
      api
        .get<
          ChatAnalyticsPage<Row>
        >(`/chat-analytics/v2/${drill.endpoint}`, { params: { ...params, ...drill.filters, page, limit: 20 } })
        .then((r) => r.data),
    retry: false,
  });
  const zone = params.company === 'SHOP' ? 'shop' : 'fin';
  const target = (r: Row) => {
    if ('businessSaleKey' in r)
      return r.type === 'SALE'
        ? `/sales?search=${encodeURIComponent(r.number)}&zone=${zone}`
        : `/contracts/${r.id}?zone=${zone}`;
    if ('customerId' in r) return `/customers/${r.customerId}?zone=${zone}`;
    const search = new URLSearchParams({ zone });
    if ('targetType' in r && r.targetType !== 'ROOM')
      search.set(
        r.targetType === 'SERVICE_REQUEST'
          ? 'serviceRequestId'
          : r.targetType === 'FACEBOOK_COMMENT'
            ? 'commentId'
            : 'todoId',
        r.targetId,
      );
    return `/inbox${r.roomId ? `/${r.roomId}` : ''}?${search}`;
  };
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full min-w-0 overflow-y-auto sm:max-w-2xl">
        <SheetTitle className="pr-6">{drill.title}</SheetTitle>
        <SheetDescription>ขอบเขต {params.company} · รายการอ่านใหม่ ณ เวลาที่แสดง</SheetDescription>
        <QueryBoundary
          isLoading={query.isLoading}
          isError={query.isError}
          error={query.error}
          onRetry={() => query.refetch()}
        >
          {query.data && (
            <>
              <div className="flex flex-wrap justify-between gap-2 text-sm">
                <b>{query.data.total} รายการ</b>
                <span className="text-muted-foreground">
                  {analyticsDate(query.data.observedAt)}
                </span>
              </div>
              <div className="divide-y">
                {query.data.data.map((r, index) => (
                  <div
                    key={'id' in r ? `${r.id}:${index}` : r.customerId}
                    className="min-w-0 py-4 text-sm"
                  >
                    <Link
                      className="block min-h-11 break-words font-medium text-primary underline underline-offset-4"
                      to={target(r)}
                    >
                      {'title' in r ? r.title : 'number' in r ? r.number : r.name}
                    </Link>
                    {'firstHumanSentAt' in r ? (
                      <div className="space-y-1 text-muted-foreground">
                        <p>เริ่มรอบ {analyticsDate(r.startedAt)}</p>
                        <p>
                          คน {formatMetric(r.humanMinutes, 'นาที')} · บอท{' '}
                          {formatMetric(r.botMinutes, 'นาที')}
                        </p>
                        <p>
                          ผู้ตอบ: {r.staffName ?? 'ไม่ทราบ'} · ผู้ดูแลตอนเปิดรอบ:{' '}
                          {r.assignedAtOpenName ?? 'ยังไม่มอบหมาย'}
                        </p>
                      </div>
                    ) : 'businessSaleKey' in r ? (
                      <div className="space-y-1 text-muted-foreground">
                        <p>
                          {formatDocumentAmount(r.amount)} · {r.customerName ?? 'ไม่ทราบลูกค้า'}
                        </p>
                        <p>
                          เจ้าของยอด: {r.salespersonName ?? 'ไม่ทราบ'} ·{' '}
                          {analyticsDate(r.createdAt)}
                        </p>
                        <p>หลักฐานทักก่อนขาย: {analyticsDate(r.firstInboundAt)}</p>
                      </div>
                    ) : 'firstInboundAt' in r ? (
                      <p className="text-muted-foreground">
                        ทัก {analyticsDate(r.firstInboundAt)} · {r.stage}
                        {r.lostReason ? ` · ${r.lostReason}` : ''}
                      </p>
                    ) : (
                      <p className="text-muted-foreground">{analyticsDate(r.occurredAt)}</p>
                    )}
                  </div>
                ))}
              </div>
              {!query.data.total && (
                <p className="py-8 text-sm text-muted-foreground">ไม่มีรายการในขอบเขตนี้</p>
              )}
              <div className="flex items-center justify-between gap-2 border-t pt-4">
                <Button variant="outline" disabled={page === 1} onClick={() => setPage(page - 1)}>
                  ก่อนหน้า
                </Button>
                <span className="text-sm">
                  {page} / {Math.max(1, Math.ceil(query.data.total / 20))}
                </span>
                <Button
                  variant="outline"
                  disabled={page * 20 >= query.data.total}
                  onClick={() => setPage(page + 1)}
                >
                  ถัดไป
                </Button>
              </div>
            </>
          )}
        </QueryBoundary>
      </SheetContent>
    </Sheet>
  );
}
