import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ShieldCheck, ShieldAlert, Shield, Users, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import QueryErrorBlock from '@/components/ui/QueryErrorBlock';

interface ScoreDistribution {
  distribution: { range: string; count: number }[];
  avgScore: number;
  totalChecked: number;
}

interface RiskOverview {
  riskLevels: { level: string; label: string; count: number; percentage: number }[];
  recentChecks: {
    id: string;
    customerName: string;
    contractNumber: string;
    score: number;
    riskLevel: string;
    recommendation: string;
    createdAt: string;
  }[];
  total: number;
}

const riskColors: Record<string, string> = {
  LOW_RISK: 'text-green-600 dark:text-green-400',
  MEDIUM_RISK: 'text-yellow-600 dark:text-yellow-400',
  HIGH_RISK: 'text-red-600 dark:text-red-400',
};

const riskBgColors: Record<string, string> = {
  LOW_RISK: 'bg-green-100 dark:bg-green-900/30',
  MEDIUM_RISK: 'bg-yellow-100 dark:bg-yellow-900/30',
  HIGH_RISK: 'bg-red-100 dark:bg-red-900/30',
};

const riskIcons: Record<string, typeof Shield> = {
  LOW_RISK: ShieldCheck,
  MEDIUM_RISK: Shield,
  HIGH_RISK: ShieldAlert,
};

const recLabels: Record<string, { text: string; color: string }> = {
  APPROVE: { text: 'อนุมัติ', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  APPROVE_WITH_CONDITION: { text: 'อนุมัติแบบมีเงื่อนไข', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  REJECT: { text: 'ปฏิเสธ', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
};

const barColors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-blue-500', 'bg-green-500'];

export default function CreditScoringDashboardPage() {
  const {
    data: scoreDist,
    isError: scoreError,
    refetch: refetchScore,
  } = useQuery<ScoreDistribution>({
    queryKey: ['credit-score-distribution'],
    queryFn: () => api.get('/credit-checks/analytics/score-distribution').then((r) => r.data),
  });

  const {
    data: riskOverview,
    isError: riskError,
    refetch: refetchRisk,
  } = useQuery<RiskOverview>({
    queryKey: ['credit-risk-overview'],
    queryFn: () => api.get('/credit-checks/analytics/risk-overview').then((r) => r.data),
  });

  const maxDist = Math.max(...(scoreDist?.distribution.map((d) => d.count) || [1]), 1);

  return (
    <div className="flex flex-col gap-5 lg:gap-7">
      {/* Header */}
      <div>
        <h1 className="text-xl font-semibold text-foreground">Credit Scoring Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">วิเคราะห์ความเสี่ยงและคะแนนเครดิต</p>
      </div>

      {scoreError && <QueryErrorBlock message="โหลดข้อมูลไม่สำเร็จ" onRetry={() => { refetchScore(); refetchRisk(); }} />}

      {/* KPI Cards */}
      {scoreDist && riskOverview && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                  <TrendingUp className="size-4 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <p className="text-2xs text-muted-foreground">คะแนนเฉลี่ย</p>
                  <p className="text-2xl font-bold text-foreground">{scoreDist.avgScore}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                  <Users className="size-4 text-purple-600 dark:text-purple-400" />
                </div>
                <div>
                  <p className="text-2xs text-muted-foreground">ตรวจเครดิตทั้งหมด</p>
                  <p className="text-2xl font-bold text-foreground">{scoreDist.totalChecked}</p>
                </div>
              </div>
            </CardContent>
          </Card>
          {riskOverview.riskLevels.filter((r) => r.level !== 'MEDIUM_RISK').map((r) => {
            const Icon = riskIcons[r.level] || Shield;
            return (
              <Card key={r.level}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-3">
                    <div className={cn('p-2 rounded-lg', riskBgColors[r.level])}>
                      <Icon className={cn('size-4', riskColors[r.level])} />
                    </div>
                    <div>
                      <p className="text-2xs text-muted-foreground">{r.label}</p>
                      <p className="text-2xl font-bold text-foreground">
                        {r.percentage}%
                      </p>
                      <p className="text-2xs text-muted-foreground">{r.count} ราย</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-7">
        {/* Score Distribution */}
        {scoreDist && (
          <Card>
            <CardHeader>
              <CardTitle>การกระจายคะแนน</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {scoreDist.distribution.map((d, i) => (
                  <div key={d.range} className="flex items-center gap-4">
                    <div className="w-16 text-xs font-medium text-foreground shrink-0">
                      {d.range}
                    </div>
                    <div className="flex-1 bg-muted rounded-full h-5 overflow-hidden">
                      <div
                        className={cn('h-full rounded-full opacity-80', barColors[i])}
                        style={{
                          width: maxDist > 0 ? `${(d.count / maxDist) * 100}%` : '0%',
                          minWidth: d.count > 0 ? '8px' : '0',
                        }}
                      />
                    </div>
                    <div className="w-12 text-right text-sm font-semibold text-foreground">
                      {d.count}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Risk Level Breakdown */}
        {riskOverview && (
          <Card>
            <CardHeader>
              <CardTitle>ระดับความเสี่ยง</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {riskOverview.riskLevels.map((r) => {
                  const Icon = riskIcons[r.level] || Shield;
                  return (
                    <div
                      key={r.level}
                      className={cn(
                        'flex items-center justify-between p-4 rounded-xl',
                        riskBgColors[r.level],
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <Icon className={cn('size-5', riskColors[r.level])} />
                        <div>
                          <p className={cn('text-sm font-semibold', riskColors[r.level])}>
                            {r.label}
                          </p>
                          <p className="text-xs text-muted-foreground">{r.count} ราย</p>
                        </div>
                      </div>
                      <div className={cn('text-2xl font-bold', riskColors[r.level])}>
                        {r.percentage}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Recent Credit Checks Table */}
      {riskOverview && riskOverview.recentChecks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>ตรวจเครดิตล่าสุด</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto -mx-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 text-left text-muted-foreground">
                    <th className="px-3 pb-3 pt-2 font-medium text-xs">วันที่</th>
                    <th className="px-3 pb-3 pt-2 font-medium text-xs">ลูกค้า</th>
                    <th className="px-3 pb-3 pt-2 font-medium text-xs">สัญญา</th>
                    <th className="px-3 pb-3 pt-2 font-medium text-xs text-center">คะแนน</th>
                    <th className="px-3 pb-3 pt-2 font-medium text-xs text-center">ระดับ</th>
                    <th className="px-3 pb-3 pt-2 font-medium text-xs text-center">คำแนะนำ</th>
                  </tr>
                </thead>
                <tbody>
                  {riskOverview.recentChecks.map((check) => (
                    <tr
                      key={check.id}
                      className="border-b border-border/30 last:border-0 hover:bg-muted/50 transition-colors"
                    >
                      <td className="px-3 py-2.5 text-muted-foreground text-xs">
                        {new Date(check.createdAt).toLocaleDateString('th-TH')}
                      </td>
                      <td className="px-3 py-2.5 font-medium text-foreground">
                        {check.customerName}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">
                        {check.contractNumber}
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span
                          className={cn(
                            'inline-flex px-2 py-0.5 rounded-md text-xs font-bold',
                            check.score >= 80
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : check.score >= 50
                                ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                          )}
                        >
                          {check.score}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <Badge
                          variant="secondary"
                          className={cn('text-2xs', riskBgColors[check.riskLevel], riskColors[check.riskLevel])}
                        >
                          {check.riskLevel === 'LOW_RISK'
                            ? 'ต่ำ'
                            : check.riskLevel === 'MEDIUM_RISK'
                              ? 'กลาง'
                              : 'สูง'}
                        </Badge>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {recLabels[check.recommendation] ? (
                          <Badge
                            variant="secondary"
                            className={cn('text-2xs', recLabels[check.recommendation].color)}
                          >
                            {recLabels[check.recommendation].text}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">{check.recommendation}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
