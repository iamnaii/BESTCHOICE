import { useNavigate } from 'react-router';
import { Card, CardHeader, CardTitle, CardToolbar, CardTable } from '@/components/ui/card';
import {
  ShieldAlert,
  ArrowRight,
  Phone,
  Sparkles,
} from 'lucide-react';
import type { WatchList, UpsellCandidates } from '../types';
import { Badge } from '@/components/ui/badge';
import { getStatusBadgeProps, riskLevelMap } from '@/lib/status-badges';

interface DashboardWatchListProps {
  watchListData: WatchList | undefined;
  upsell: UpsellCandidates | undefined;
}

export default function DashboardWatchList({ watchListData, upsell }: DashboardWatchListProps) {
  const navigate = useNavigate();

  return (
    <>
      {/* Early Warning Watch List */}
      {watchListData && watchListData.total > 0 && (
        <Card className="border-warning/30">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldAlert className="size-4 text-warning" />
              Watch List — ลูกค้าเสี่ยงค้างชำระ
            </CardTitle>
            <CardToolbar>
              {watchListData.highCount > 0 && (
                <Badge variant="destructive" appearance="light" size="sm">สูง {watchListData.highCount}</Badge>
              )}
              {watchListData.mediumCount > 0 && (
                <Badge variant="warning" appearance="light" size="sm" className="ml-1">กลาง {watchListData.mediumCount}</Badge>
              )}
              <button
                onClick={() => navigate('/customers')}
                className="text-xs text-primary hover:underline ml-2 flex items-center gap-1"
              >
                ดูทั้งหมด <ArrowRight className="size-3" />
              </button>
            </CardToolbar>
          </CardHeader>
          <CardTable>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 border-b border-border/60">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">ลูกค้า</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">สัญญา</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">ความเสี่ยง</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">สาเหตุ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {watchListData.watchList.slice(0, 8).map((w) => {
                  const riskCfg = getStatusBadgeProps(w.riskLevel, riskLevelMap);
                  return (
                    <tr
                      key={w.contractId}
                      className="hover:bg-muted/30 transition-colors cursor-pointer"
                      onClick={() => navigate(`/customers/${w.customerId}`)}
                    >
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-foreground">{w.customerName}</div>
                        <div className="text-2xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Phone className="size-3" />{w.customerPhone}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 hidden sm:table-cell">
                        <span className="text-xs text-foreground font-mono">{w.contractNumber}</span>
                      </td>
                      <td className="px-5 py-3.5">
                        <Badge variant={riskCfg.variant} appearance={riskCfg.appearance} size="sm">{riskCfg.label}</Badge>
                      </td>
                      <td className="px-5 py-3.5 hidden md:table-cell">
                        <div className="flex flex-wrap gap-1">
                          {w.reasons.map((r) => (
                            <span key={r} className="text-2xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                              {r}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardTable>
        </Card>
      )}

      {/* Upsell Candidates Widget */}
      {upsell && upsell.total > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="size-4 text-warning" />
              ลูกค้าพร้อมอัพเกรด
            </CardTitle>
            <CardToolbar>
              <span className="text-2xs font-semibold text-warning bg-warning/10 px-2.5 py-1 rounded-md">
                {upsell.total} ราย
              </span>
              <button
                onClick={() => navigate('/customers?contractStatus=ACTIVE')}
                className="text-xs text-primary hover:underline ml-2 flex items-center gap-1"
              >
                ดูทั้งหมด <ArrowRight className="size-3" />
              </button>
            </CardToolbar>
          </CardHeader>
          <CardTable>
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-muted/40 border-b border-border/60">
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">ลูกค้า</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden sm:table-cell">เครื่อง</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider">ความคืบหน้า</th>
                  <th className="text-left px-5 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider hidden md:table-cell">เหตุผล</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {upsell.candidates.map((c) => (
                  <tr
                    key={c.contractId}
                    className="hover:bg-muted/30 transition-colors cursor-pointer"
                    onClick={() => navigate(`/customers/${c.customerId}`)}
                  >
                    <td className="px-5 py-3.5">
                      <div className="font-medium text-foreground">{c.customerName}</div>
                      <div className="text-2xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        <Phone className="size-3" />{c.customerPhone}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 hidden sm:table-cell">
                      <span className="text-xs text-foreground">{c.productModel ?? '-'}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full rounded-full bg-warning"
                            style={{ width: `${Math.min(c.paidRatio * 100, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs font-medium text-foreground">
                          {c.paidCount}/{c.totalMonths}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 hidden md:table-cell">
                      <span className="text-xs px-2 py-0.5 rounded-full bg-warning/10 text-warning font-medium">
                        {c.reason}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardTable>
        </Card>
      )}
    </>
  );
}
