import { useQuery } from '@tanstack/react-query';
import api from '@/lib/api';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { TrendingUp, TrendingDown, DollarSign, Users, Target } from 'lucide-react';

const PLATFORM_LABELS: Record<string, string> = {
  LINE_ADS: 'LINE Ads',
  FACEBOOK_ADS: 'Facebook Ads',
  TIKTOK_ADS: 'TikTok Ads',
  GOOGLE_ADS: 'Google Ads',
};

const PLATFORM_COLORS: Record<string, string> = {
  LINE_ADS: 'bg-green-500',
  FACEBOOK_ADS: 'bg-blue-600',
  TIKTOK_ADS: 'bg-pink-500',
  GOOGLE_ADS: 'bg-red-500',
};

export default function AdsTrackingPage() {
  const roiQuery = useQuery({
    queryKey: ['ads-roi'],
    queryFn: () => api.get('/api/ads/roi').then((r: any) => r.data),
  });

  const campaignsQuery = useQuery({
    queryKey: ['ads-campaigns'],
    queryFn: () => api.get('/api/ads/campaigns').then((r: any) => r.data),
  });

  const roiData = roiQuery.data ?? [];
  const campaigns = campaignsQuery.data?.data ?? [];

  // Aggregate stats
  const totalSpend = roiData.reduce((s: number, r: any) => s + (r.spend ?? 0), 0);
  const totalRevenue = roiData.reduce((s: number, r: any) => s + (r.totalRevenue ?? 0), 0);
  const totalConversions = roiData.reduce((s: number, r: any) => s + (r.conversions ?? 0), 0);
  const overallROI = totalSpend > 0 ? Math.round(((totalRevenue - totalSpend) / totalSpend) * 100) : 0;

  return (
    <div>
      <PageHeader
        title="Ads & ROI Tracking"
        subtitle="ติดตาม ROI ของแต่ละแคมเปญโฆษณา"
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-red-500" />
            <span className="text-xs text-gray-500">ค่าโฆษณารวม</span>
          </div>
          <p className="text-xl font-bold text-gray-900">{totalSpend.toLocaleString()} ฿</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <DollarSign className="w-4 h-4 text-green-500" />
            <span className="text-xs text-gray-500">รายได้จาก Ads</span>
          </div>
          <p className="text-xl font-bold text-gray-900">{totalRevenue.toLocaleString()} ฿</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-blue-500" />
            <span className="text-xs text-gray-500">Conversions</span>
          </div>
          <p className="text-xl font-bold text-gray-900">{totalConversions}</p>
        </div>
        <div className="bg-white rounded-xl p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            {overallROI >= 0 ? (
              <TrendingUp className="w-4 h-4 text-green-500" />
            ) : (
              <TrendingDown className="w-4 h-4 text-red-500" />
            )}
            <span className="text-xs text-gray-500">ROI รวม</span>
          </div>
          <p className={`text-xl font-bold ${overallROI >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {overallROI}%
          </p>
        </div>
      </div>

      {/* ROI per campaign */}
      <QueryBoundary
        isLoading={roiQuery.isLoading}
        isError={roiQuery.isError}
        error={roiQuery.error}
        onRetry={() => roiQuery.refetch()}
      >
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700">ROI per Campaign</h3>
          </div>

          {roiData.length === 0 ? (
            <div className="p-12 text-center text-gray-400">
              <Target className="w-8 h-8 mx-auto mb-2" />
              <p>ยังไม่มีแคมเปญ</p>
              <p className="text-xs mt-1">เพิ่มแคมเปญผ่าน API: POST /api/ads/campaigns</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">แคมเปญ</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Platform</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">ค่าโฆษณา</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">รายได้</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">Conversions</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">ROI</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {roiData.map((row: any) => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{row.campaignName}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-1 rounded-full text-white ${PLATFORM_COLORS[row.platform] ?? 'bg-gray-500'}`}>
                        {PLATFORM_LABELS[row.platform] ?? row.platform}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">{(row.spend ?? 0).toLocaleString()} ฿</td>
                    <td className="px-4 py-3 text-right text-gray-600">{(row.totalRevenue ?? 0).toLocaleString()} ฿</td>
                    <td className="px-4 py-3 text-right text-gray-600">{row.conversions ?? 0}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${(row.roi ?? 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {row.roi ?? 0}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </QueryBoundary>
    </div>
  );
}
