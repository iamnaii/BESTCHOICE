import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { TrendingUp, TrendingDown, DollarSign, Users, Target } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

const PLATFORM_LABELS: Record<string, string> = {
  LINE_ADS: 'LINE Ads',
  FACEBOOK_ADS: 'Facebook Ads',
  TIKTOK_ADS: 'TikTok Ads',
  GOOGLE_ADS: 'Google Ads',
};

const PLATFORM_COLORS: Record<string, string> = {
  LINE_ADS: 'bg-success',
  FACEBOOK_ADS: 'bg-info',
  TIKTOK_ADS: 'bg-secondary',
  GOOGLE_ADS: 'bg-destructive',
};

export default function AdsTrackingPage() {
  const roiQuery = useQuery({
    queryKey: ['ads-roi'],
    queryFn: () => api.get('/ads/roi').then((r: any) => r.data),
  });

  const campaignsQuery = useQuery({
    queryKey: ['ads-campaigns'],
    queryFn: () => api.get('/ads/campaigns').then((r: any) => r.data),
  });

  const roiData = roiQuery.data ?? [];
  const campaigns = campaignsQuery.data?.data ?? [];

  // Aggregate stats
  const totalSpend = roiData.reduce((s: number, r: any) => s + Number(r.spend ?? 0), 0);
  const totalRevenue = roiData.reduce((s: number, r: any) => s + (r.totalRevenue ?? 0), 0);
  const totalConversions = roiData.reduce((s: number, r: any) => s + (r.conversions ?? 0), 0);
  const overallROI = totalSpend > 0 ? Math.round(((totalRevenue - totalSpend) / totalSpend) * 100) : 0;
  const costPerUnit = totalConversions > 0 ? totalSpend / totalConversions : 0;

  return (
    <div>
      <PageHeader
        title="Ads & ROI Tracking"
        subtitle="ติดตาม ROI ของแต่ละแคมเปญโฆษณา"
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
        <div className="bg-card rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-destructive" />
            <span className="text-xs text-muted-foreground">ค่าโฆษณารวม</span>
          </div>
          <p className="text-xl font-bold text-foreground">{totalSpend.toLocaleString()} ฿</p>
        </div>
        <div className="bg-card rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-success" />
            <span className="text-xs text-muted-foreground">รายได้จาก Ads</span>
          </div>
          <p className="text-xl font-bold text-foreground">{totalRevenue.toLocaleString()} ฿</p>
        </div>
        <div className="bg-card rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Conversions</span>
          </div>
          <p className="text-xl font-bold text-foreground">{totalConversions}</p>
        </div>
        <div className="bg-card rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            {overallROI >= 0 ? (
              <TrendingUp className="w-4 h-4 text-success" />
            ) : (
              <TrendingDown className="w-4 h-4 text-destructive" />
            )}
            <span className="text-xs text-muted-foreground">ROI รวม</span>
          </div>
          <p className={`text-xl font-bold ${overallROI >= 0 ? 'text-success' : 'text-destructive'}`}>
            {overallROI}%
          </p>
        </div>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-[13px] text-muted-foreground font-medium">Cost per Unit Sold</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">฿{costPerUnit.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
            <p className="text-[11px] text-muted-foreground">ค่าโฆษณาต่อการขาย 1 เครื่อง</p>
          </CardContent>
        </Card>
      </div>

      {/* ROI per campaign */}
      <QueryBoundary
        isLoading={roiQuery.isLoading}
        isError={roiQuery.isError}
        error={roiQuery.error}
        onRetry={() => roiQuery.refetch()}
      >
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>ROI per Campaign</CardTitle>
          </CardHeader>
          <CardContent className="p-0">

          {roiData.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              <Target className="w-8 h-8 mx-auto mb-2" />
              <p>ยังไม่มีแคมเปญ</p>
              <p className="text-xs mt-1">เพิ่มแคมเปญผ่าน API: POST /api/ads/campaigns</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">แคมเปญ</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Platform</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">ค่าโฆษณา</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">รายได้</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Conversions</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">Cost/Unit</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-muted-foreground">ROI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {roiData.map((row: any) => (
                  <tr key={row.id} className="hover:bg-muted/50">
                    <td className="px-4 py-3 font-medium text-foreground">{row.campaignName}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full text-white ${PLATFORM_COLORS[row.platform] ?? 'bg-muted-foreground'}`}>
                        {PLATFORM_LABELS[row.platform] ?? row.platform}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-foreground/70">{(row.spend ?? 0).toLocaleString()} ฿</td>
                    <td className="px-4 py-3 text-right text-foreground/70">{(row.totalRevenue ?? 0).toLocaleString()} ฿</td>
                    <td className="px-4 py-3 text-right text-foreground/70">{row.conversions ?? 0}</td>
                    <td className="px-4 py-3 text-right text-foreground/70">
                      {row.conversions > 0 ? `฿${(Number(row.spend) / row.conversions).toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '-'}
                    </td>
                    <td className={`px-4 py-3 text-right font-semibold ${(row.roi ?? 0) >= 0 ? 'text-success' : 'text-destructive'}`}>
                      {row.roi ?? 0}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </CardContent>
        </Card>
      </QueryBoundary>
    </div>
  );
}
