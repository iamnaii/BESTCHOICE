import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '@/lib/api';
import { toast } from 'sonner';
import QueryBoundary from '@/components/QueryBoundary';
import PageHeader from '@/components/ui/PageHeader';
import { KanbanBoard, type KanbanColumn } from '@/components/ui/KanbanBoard';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { User, Phone, FileText, ShoppingCart, ChevronDown, ChevronUp } from 'lucide-react';

/* ─── Stage model ──────────────────────────────────────────────
 *
 * Spec target (CSV / P2-SP1):  เสนอ / ติดต่อ / เสนอราคา / ปิดการขาย / ยกเลิก
 * Schema enum LeadStage:        NEW_LEAD / QUALIFIED / PROPOSAL / NEGOTIATION / WON / LOST
 *
 * The schema has 6 enum values but the spec defines 4 active stages + LOST.
 * To avoid a destructive enum migration we collapse PROPOSAL+NEGOTIATION into
 * a single visual column "เสนอราคา" (CrmStageKey = QUOTED). Drag-drop into
 * that column writes PROPOSAL (the canonical "quote sent" value). Legacy
 * NEGOTIATION rows render in the QUOTED column until the user moves them.
 */

export type CrmStageKey = 'LEAD' | 'CONTACTED' | 'QUOTED' | 'WON' | 'LOST';

interface StageConfig {
  key: CrmStageKey;
  label: string;
  color: string; // tailwind bg-* token (no hardcoded hex)
  /** LeadStage enum values that fall under this column. */
  enumValues: string[];
  /** Canonical LeadStage value written when a card is dropped into this column. */
  writeValue: string;
}

export const STAGES: StageConfig[] = [
  {
    key: 'LEAD',
    label: 'เสนอ',
    color: 'bg-sky-500',
    enumValues: ['NEW_LEAD'],
    writeValue: 'NEW_LEAD',
  },
  {
    key: 'CONTACTED',
    label: 'ติดต่อ',
    color: 'bg-amber-500',
    enumValues: ['QUALIFIED'],
    writeValue: 'QUALIFIED',
  },
  {
    key: 'QUOTED',
    label: 'เสนอราคา',
    color: 'bg-purple-500',
    enumValues: ['PROPOSAL', 'NEGOTIATION'],
    writeValue: 'PROPOSAL',
  },
  {
    key: 'WON',
    label: 'ปิดการขาย',
    color: 'bg-emerald-500',
    enumValues: ['WON'],
    writeValue: 'WON',
  },
  {
    key: 'LOST',
    label: 'ยกเลิก',
    color: 'bg-destructive',
    enumValues: ['LOST'],
    writeValue: 'LOST',
  },
];

/** Map a raw LeadStage enum value to its display column key. */
export function stageEnumToKey(enumValue: string | undefined | null): CrmStageKey {
  if (!enumValue) return 'LEAD';
  for (const s of STAGES) {
    if (s.enumValues.includes(enumValue)) return s.key;
  }
  return 'LEAD';
}

type FilterKey = 'ALL' | CrmStageKey;

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'ALL', label: 'ทั้งหมด' },
  { key: 'LEAD', label: 'เสนอ' },
  { key: 'CONTACTED', label: 'ติดต่อ' },
  { key: 'QUOTED', label: 'เสนอราคา' },
  { key: 'WON', label: 'ปิดการขาย' },
  { key: 'LOST', label: 'ยกเลิก' },
];

interface CrmLead {
  id: string;
  stage: string; // LeadStage enum value
  interestedProduct?: string | null;
  customer?: { id: string; name: string; phone?: string | null } | null;
  assignedTo?: { id: string; name: string } | null;
}

export default function CrmPipelinePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterKey>('ALL');
  const [showLost, setShowLost] = useState(false);

  // Fetch up to 200 leads (Kanban needs ALL stages at once — no server-side
  // stage filter so we can rebuild every column locally on each render).
  const leadsQuery = useQuery({
    queryKey: ['crm-leads', 'all'],
    queryFn: () => api.get('/crm/leads', { params: { limit: 200 } }).then((r: any) => r.data),
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
    onError: () => {
      toast.error('อัปเดต stage ไม่สำเร็จ');
    },
  });

  const allLeads: CrmLead[] = leadsQuery.data?.data ?? [];

  // Build the 5 Kanban columns. Filter by chip first (ALL = no filter).
  const columns = useMemo<KanbanColumn<CrmLead>[]>(() => {
    const visibleStages =
      filter === 'ALL' ? STAGES : STAGES.filter((s) => s.key === filter);

    return visibleStages
      // When LOST is collapsed and filter is ALL, skip the LOST column entirely.
      .filter((s) => !(s.key === 'LOST' && filter === 'ALL' && !showLost))
      .map((s) => ({
        id: s.key,
        title: s.label,
        color: s.color,
        items: allLeads.filter((l) => s.enumValues.includes(l.stage)),
      }));
  }, [allLeads, filter, showLost]);

  const handleCardMove = (leadId: string, fromColumnId: string, toColumnId: string) => {
    if (fromColumnId === toColumnId) return;
    const target = STAGES.find((s) => s.key === (toColumnId as CrmStageKey));
    if (!target) return;
    moveStageMutation.mutate({ id: leadId, stage: target.writeValue });
  };

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
            <p className="text-2xl font-bold text-foreground">{dashboard.total ?? 0}</p>
          </div>
          <div className="bg-card rounded-xl p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">Conversion Rate</p>
            <p className="text-2xl font-bold text-success">
              {dashboard.conversionRate ?? 0}%
            </p>
          </div>
          <div className="bg-card rounded-xl p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">เสนอ</p>
            <p className="text-2xl font-bold text-foreground">
              {dashboard.stages?.NEW_LEAD ?? 0}
            </p>
          </div>
          <div className="bg-card rounded-xl p-4 shadow-sm">
            <p className="text-xs text-muted-foreground">ปิดการขาย</p>
            <p className="text-2xl font-bold text-emerald-600">
              {dashboard.stages?.WON ?? 0}
            </p>
          </div>
        </div>
      )}

      {/* Filter chip row */}
      <div
        className="flex flex-wrap gap-2 mb-4"
        role="tablist"
        aria-label="กรอง stage"
      >
        {FILTERS.map((f) => {
          const isActive = filter === f.key;
          return (
            <button
              key={f.key}
              role="tab"
              aria-selected={isActive}
              onClick={() => setFilter(f.key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium leading-snug transition-colors ${
                isActive
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-card text-muted-foreground hover:bg-accent border border-border'
              }`}
            >
              {f.label}
            </button>
          );
        })}

        {/* Toggle LOST visibility (only meaningful in ALL view) */}
        {filter === 'ALL' && (
          <button
            onClick={() => setShowLost((v) => !v)}
            className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium leading-snug text-muted-foreground hover:bg-accent border border-dashed border-border"
            aria-label={showLost ? 'ซ่อนยกเลิก' : 'แสดงยกเลิก'}
            aria-expanded={showLost}
          >
            {showLost ? (
              <ChevronUp className="size-4" />
            ) : (
              <ChevronDown className="size-4" />
            )}
            {showLost ? 'ซ่อนยกเลิก' : 'แสดงยกเลิก'}
          </button>
        )}
      </div>

      {/* Kanban board */}
      <QueryBoundary
        isLoading={leadsQuery.isLoading}
        isError={leadsQuery.isError}
        error={leadsQuery.error}
        onRetry={() => leadsQuery.refetch()}
        errorTitle="ไม่สามารถโหลด Lead ได้"
      >
        {allLeads.length === 0 ? (
          <Card>
            <CardContent className="p-12 text-center text-muted-foreground">
              ไม่พบ Lead
            </CardContent>
          </Card>
        ) : (
          <KanbanBoard<CrmLead>
            columns={columns}
            onCardMove={handleCardMove}
            emptyMessage="ไม่มี Lead ในขั้นนี้"
            renderCard={(lead) => {
              const stageKey = stageEnumToKey(lead.stage);
              return (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <User className="size-4 text-muted-foreground shrink-0" />
                    <span className="text-sm font-semibold text-foreground leading-snug truncate">
                      {lead.customer?.name ?? 'ไม่ระบุชื่อ'}
                    </span>
                  </div>

                  {lead.customer?.phone && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground leading-snug">
                      <Phone className="size-3" />
                      <span className="truncate">{lead.customer.phone}</span>
                    </div>
                  )}

                  {lead.interestedProduct && (
                    <p className="text-xs text-muted-foreground leading-snug line-clamp-2">
                      {lead.interestedProduct}
                    </p>
                  )}

                  {lead.assignedTo && (
                    <Badge variant="secondary" size="sm" className="self-start">
                      พนง: {lead.assignedTo.name}
                    </Badge>
                  )}

                  {/* Stage-specific quick actions */}
                  {stageKey === 'QUOTED' && lead.customer?.id && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/quotes?customerId=${lead.customer!.id}`);
                      }}
                      className="mt-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium leading-snug bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                      aria-label="สร้างใบเสนอราคา"
                    >
                      <FileText className="size-3.5" />
                      สร้างใบเสนอราคา
                    </button>
                  )}

                  {stageKey === 'WON' && lead.customer?.id && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/pos?customerId=${lead.customer!.id}`);
                      }}
                      className="mt-1 inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium leading-snug bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 transition-colors"
                      aria-label="เปิด POS"
                    >
                      <ShoppingCart className="size-3.5" />
                      เปิด POS
                    </button>
                  )}
                </div>
              );
            }}
          />
        )}
      </QueryBoundary>
    </div>
  );
}
