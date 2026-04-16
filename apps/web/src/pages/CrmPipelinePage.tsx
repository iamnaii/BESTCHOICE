import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { User, Phone, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';

const STAGES = [
  { key: 'NEW_LEAD', label: 'Lead ใหม่', color: 'bg-blue-500' },
  { key: 'QUALIFIED', label: 'สนใจจริง', color: 'bg-cyan-500' },
  { key: 'PROPOSAL', label: 'เสนอราคา', color: 'bg-yellow-500' },
  { key: 'NEGOTIATION', label: 'รอตัดสินใจ', color: 'bg-orange-500' },
  { key: 'WON', label: 'ปิดการขาย', color: 'bg-green-500' },
  { key: 'LOST', label: 'ไม่ซื้อ', color: 'bg-gray-400' },
];

export default function CrmPipelinePage() {
  const queryClient = useQueryClient();
  const [activeStage, setActiveStage] = useState<string | undefined>();

  const leadsQuery = useQuery({
    queryKey: ['crm-leads', activeStage],
    queryFn: () =>
      api.get('/crm/leads', { params: { stage: activeStage, limit: 100 } }).then((r: any) => r.data),
  });

  const dashboardQuery = useQuery({
    queryKey: ['crm-dashboard'],
    queryFn: () => api.get('/crm/dashboard').then((r: any) => r.data),
  });

  const moveStageMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) =>
      api.patch(`/crm/leads/${id}/stage`, { stage }),
    onSuccess: () => {
      toast.success('อัปเดต stage แล้ว');
      queryClient.invalidateQueries({ queryKey: ['crm-leads'] });
      queryClient.invalidateQueries({ queryKey: ['crm-dashboard'] });
    },
  });

  const leads = leadsQuery.data?.data ?? [];
  const dashboard = dashboardQuery.data;

  return (
    <div>
      <PageHeader
        title="CRM Pipeline"
        subtitle="ติดตามลูกค้าตั้งแต่แชทจนปิดสัญญา"
      />

      {/* Dashboard summary */}
      {dashboard && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-card rounded-xl p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">ทั้งหมด</p>
            <p className="text-2xl font-bold text-foreground">{dashboard.total}</p>
          </div>
          <div className="bg-card rounded-xl p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Conversion Rate</p>
            <p className="text-2xl font-bold text-green-600">{dashboard.conversionRate}%</p>
          </div>
          {STAGES.slice(0, 2).map((s) => (
            <div key={s.key} className="bg-card rounded-xl p-4 shadow-sm">
              <p className="text-xs text-muted-foreground">{s.label}</p>
              <p className="text-2xl font-bold text-foreground">{dashboard.stages?.[s.key] ?? 0}</p>
            </div>
          ))}
        </div>
      )}

      {/* Stage filter tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-2">
        <button
          onClick={() => setActiveStage(undefined)}
          className={`px-4 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${
            !activeStage ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:bg-muted'
          }`}
        >
          ทั้งหมด
        </button>
        {STAGES.map((s) => (
          <button
            key={s.key}
            onClick={() => setActiveStage(s.key)}
            className={`px-4 py-2 rounded-lg text-sm whitespace-nowrap transition-colors ${
              activeStage === s.key ? 'bg-foreground text-background' : 'bg-card text-muted-foreground hover:bg-muted'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Leads list */}
      <QueryBoundary
        isLoading={leadsQuery.isLoading}
        isError={leadsQuery.isError}
        error={leadsQuery.error}
        onRetry={() => leadsQuery.refetch()}
      >
        <Card className="overflow-hidden">
          <CardContent className="p-0">
          {leads.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">ไม่พบ Lead</div>
          ) : (
            <div className="divide-y">
              {leads.map((lead: any) => {
                const stageInfo = STAGES.find((s) => s.key === lead.stage);
                return (
                  <div key={lead.id} className="px-4 py-3 flex items-center gap-4 hover:bg-accent">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${stageInfo?.color ?? 'bg-gray-400'}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-muted-foreground" />
                        <span className="font-medium text-sm text-foreground">
                          {lead.customer?.name ?? 'ไม่ระบุชื่อ'}
                        </span>
                        <Badge variant="secondary" size="sm">
                          {stageInfo?.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                        {lead.customer?.phone && (
                          <span className="flex items-center gap-1">
                            <Phone className="w-3 h-3" /> {lead.customer.phone}
                          </span>
                        )}
                        {lead.interestedProduct && (
                          <span>{lead.interestedProduct}</span>
                        )}
                        {lead.assignedTo && (
                          <span>พนง: {lead.assignedTo.name}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {lead.stage !== 'WON' && lead.stage !== 'LOST' && (
                        <button
                          onClick={() => {
                            const currentIdx = STAGES.findIndex((s) => s.key === lead.stage);
                            const nextStage = STAGES[currentIdx + 1];
                            if (nextStage) {
                              moveStageMutation.mutate({ id: lead.id, stage: nextStage.key });
                            }
                          }}
                          className="p-1.5 text-muted-foreground hover:text-blue-500 hover:bg-blue-50 rounded-lg"
                          title="ไปขั้นต่อไป"
                        >
                          <ChevronRight className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          </CardContent>
        </Card>
      </QueryBoundary>
    </div>
  );
}
